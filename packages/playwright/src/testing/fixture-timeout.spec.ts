import { setTimeout as delay } from 'node:timers/promises';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../fixtures.js';
import type { BlackboxAttemptRuntime } from '../runtime/acquisition.js';

const runtime = {
  async start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    await delay(100);
    return {
      sandbox: {
        sandboxId: 'timeout-sandbox',
        executionId: 'timeout-execution',
        catalogEntry: {
          id: input.selection.id,
          kind: input.selection.kind,
          declaredIsolation: { kind: 'per-test' },
        },
        projectName: 'timeout-project',
        artifactDirectory: input.artifactDirectory,
        entrypoint: {
          url: 'http://127.0.0.1:1',
          host: '127.0.0.1',
          port: 1,
          protocol: 'http',
        },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'timeout-session',
        executionId: 'timeout-execution',
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      stop: () => Promise.resolve(),
    };
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.describe('fixture acquisition timeout', () => {
  test.use({ catalogEntry: { kind: 'system', id: 'orders' } });
  test.setTimeout(20);

  test('times out before a slow acquisition reaches the test body', () => {
    playwrightExpect(true).toBe(true);
  });
});
