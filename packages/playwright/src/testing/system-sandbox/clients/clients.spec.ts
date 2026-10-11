import { expect } from '@playwright/test';
import * as clients from './api.js';
import { events, scenario } from './state.js';
import type {
  BlackboxNativeTestArgs,
  BlackboxNativeWorkerArgs,
  BlackboxSandboxSuite,
} from '../../../types.js';
import { createBlackboxSystemTest } from '../../../fixtures.js';
import { currentStepContext } from '../../../steps/step-context.js';
import { record, startRespondingAttempt } from '../runtime.fixture.js';

const test = createBlackboxSystemTest({
  async start(input) {
    const attempt = await startRespondingAttempt(input);
    const endpoint = attempt.sandbox.entrypoint;
    return {
      ...attempt,
      sandbox: {
        ...attempt.sandbox,
        containers: new Map([
          [
            'api',
            {
              service: 'api',
              testcontainer: {
                id: 'synthetic',
                name: 'synthetic',
                host: endpoint.host,
                labels: {},
                networkNames: [],
                environment: { TOKEN: 'secret' },
                mappedPorts: new Map([[3000, endpoint.port]]),
                getMappedPort: () => endpoint.port,
              },
            },
          ],
        ]),
      },
      async stop(reason) {
        record({ kind: 'client-release-order', events: [...events] });
        await attempt.stop(reason);
      },
    };
  },
});
function declareSuite(
  suite: BlackboxSandboxSuite<
    BlackboxNativeTestArgs & { readonly clients: { readonly api: { readonly url: string } } },
    BlackboxNativeWorkerArgs
  >,
): void {
  if (
    scenario === 'client-readiness-timeout' ||
    scenario === 'client-create-late' ||
    scenario === 'client-healthy-short-timeout'
  ) {
    suite.describe.configure({ timeout: scenario === 'client-healthy-short-timeout' ? 100 : 300 });
  }
  suite.beforeEach(async ({ clients, step }) => {
    expect(events).toEqual(['create', 'ready']);
    expect(clients.api.url).toMatch(/^http:\/\/127\.0\.0\.1:/u);
    await step('hook', () => {
      expect(currentStepContext()).toMatchObject({ title: 'hook' });
    });
    events.push('hook');
  });
  suite.test(
    'automatically readies clients before hooks and preserves step values',
    async ({ step }) => {
      expect(events).toEqual(['create', 'ready', 'hook']);
      const value = await step('outer', async () => {
        const outer = currentStepContext();
        expect(outer).toBeDefined();
        if (outer === undefined) {
          throw new Error('Missing outer step context');
        }
        await Promise.all(
          ['left', 'right'].map((title) =>
            step(title, async () => {
              const child = currentStepContext();
              await new Promise((resolve) => setTimeout(resolve, 5));
              expect(currentStepContext()).toBe(child);
              expect(child).toMatchObject({
                title,
                traceId: outer.traceId,
                parent: { kind: 'child', spanId: outer.spanId },
              });
            }),
          ),
        );
        expect(currentStepContext()).toBe(outer);
        return 42;
      });
      expect(value).toBe(42);
      expect(currentStepContext()).toBeUndefined();
      await expect(
        step('failed', () => {
          throw new Error('step failed');
        }),
      ).rejects.toThrow('step failed');
      expect(currentStepContext()).toBeUndefined();
      events.push('body');
    },
  );
  suite.afterEach(() => {
    events.push('after');
  });
}
if (scenario === 'direct-sandbox') {
  test.system.sandbox('orders', { clients }, declareSuite);
} else {
  test.system('orders', (system) => {
    system.sandbox('clients', { clients }, declareSuite);
  });
}
