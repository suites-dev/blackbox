import { setTimeout as delay } from 'node:timers/promises';

import { expect } from '@playwright/test';
import { defineClient } from '../../../clients/clients.js';
import { createBlackboxSystemTest } from '../../../fixtures.js';
import { currentStepContext } from '../../../steps/step-context.js';
import { record, startRespondingAttempt } from '../runtime.fixture.js';

const failReadiness = process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO === 'client-readiness-failure';
const scenario = process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO;
const events: string[] = [];
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
const api = defineClient(
  {},
  {
    target: { participant: 'api', containerPort: 3000 },
    env: ['TOKEN'] as const,
    create: async (_sdk, { endpoint, env }) => {
      expect(env.TOKEN).toBe('secret');
      if (scenario === 'client-create-late') {
        events.push('create:start');
        await delay(400);
        events.push('create:finish');
      } else {
        events.push('create');
      }
      return { url: endpoint.url };
    },
    ready: () => {
      events.push('ready');
      if (scenario === 'client-readiness-timeout') {
        return new Promise<void>(() => undefined);
      }
      if (scenario === 'client-healthy-short-timeout') {
        return delay(20);
      }
      if (failReadiness) {
        throw new Error('client readiness deliberately failed');
      }
      return undefined;
    },
    dispose: () => {
      if (scenario === 'client-readiness-timeout' || scenario === 'client-create-late') {
        events.push('dispose:start');
        const disposal = scenario === 'client-readiness-timeout' ? delay(400) : Promise.resolve();
        return disposal.then(() => {
          events.push('dispose:finish');
        });
      }
      events.push('dispose');
      return undefined;
    },
  },
);
test.system('orders', (system) => {
  system.sandbox('clients', { clients: { api } }, (suite) => {
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
  });
});
