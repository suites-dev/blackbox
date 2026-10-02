import { setTimeout as delay } from 'node:timers/promises';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';

function record(value: object): void {
  process.stdout.write(`BLACKBOX_PLAYWRIGHT_EVENT ${JSON.stringify(value)}\n`);
}

// Acquisition takes 300ms of a 400ms test timeout: more than half, less than all.
const runtime = {
  async start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    record({ kind: 'start' });
    await delay(300);
    return {
      sandbox: {
        sandboxId: 'slow-sandbox',
        executionId: 'slow-execution',
        catalogEntry: { id: input.selection.id, kind: input.selection.kind },
        projectName: 'slow-project',
        artifactDirectory: input.artifactDirectory,
        entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'slow-session',
        executionId: 'slow-execution',
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      effects: { sessionId: 'slow-session', executionId: 'slow-execution' },
      stop: (reason) => {
        record({ kind: 'stop', reason });
        return Promise.resolve();
      },
    };
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.use({ catalogEntry: { kind: 'system', id: 'orders' } });
test.setTimeout(400);

test('reaches the body and stops the sandbox after a slow acquisition', ({ sandbox }) => {
  record({ kind: 'body', sandboxId: sandbox.sandboxId });
  playwrightExpect(sandbox.sandboxId).toBe('slow-sandbox');
});
