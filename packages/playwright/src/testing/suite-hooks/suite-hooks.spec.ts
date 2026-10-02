import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';

function record(value: object): void {
  process.stdout.write(`BLACKBOX_PLAYWRIGHT_EVENT ${JSON.stringify(value)}\n`);
}

let attempts = 0;

const runtime = {
  start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    const sandboxId = `hook-sandbox-${++attempts}`;
    record({ kind: 'start', sandboxId });
    return Promise.resolve({
      sandbox: {
        sandboxId,
        executionId: sandboxId,
        catalogEntry: { id: input.selection.id, kind: input.selection.kind },
        projectName: sandboxId,
        artifactDirectory: input.artifactDirectory,
        entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: sandboxId,
        executionId: sandboxId,
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      effects: { sessionId: sandboxId, executionId: sandboxId },
      stop: (reason) => {
        record({ kind: 'stop', sandboxId, reason });
        return Promise.resolve();
      },
    });
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.use({ catalogEntry: { kind: 'system', id: 'orders' } });

test.describe('hooks that resolve baseURL and request', () => {
  test.beforeAll(({ baseURL, request }) => {
    record({ kind: 'beforeAll', baseURL: baseURL ?? null, request: typeof request });
  });

  test.beforeEach(({ sandbox }) => {
    record({ kind: 'beforeEach', sandboxId: sandbox.sandboxId });
  });

  test.afterAll(({ baseURL }) => {
    record({ kind: 'afterAll', baseURL: baseURL ?? null });
  });

  test('uses the one sandbox of its attempt', ({ baseURL, sandbox }) => {
    record({ kind: 'body', sandboxId: sandbox.sandboxId, baseURL: baseURL ?? null });
    playwrightExpect(baseURL).toBe(sandbox.entrypoint.url);
  });
});

test.describe('hooks that ask for the sandbox', () => {
  test.beforeAll(({ sandbox }) => {
    record({ kind: 'unreachable', sandboxId: sandbox.sandboxId });
  });

  test('does not run after its beforeAll hook is refused', () => {
    record({ kind: 'unreachable' });
  });
});
