import { randomUUID } from 'node:crypto';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../fixtures.js';
import type { BlackboxAttemptRuntime } from '../runtime/acquisition.js';

function record(value: object): void {
  process.stdout.write(`BLACKBOX_PLAYWRIGHT_EVENT ${JSON.stringify(value)}\n`);
}

const runtime = {
  start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    const executionId = randomUUID();
    record({
      kind: 'start',
      executionId,
      artifactDirectory: input.artifactDirectory,
      selection: input.selection,
    });
    return Promise.resolve({
      sandbox: {
        sandboxId: executionId,
        executionId,
        catalogEntry: {
          id: input.selection.id,
          kind: input.selection.kind,
        },
        projectName: `blackbox-${executionId}`,
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
        sessionId: `session-${executionId}`,
        executionId,
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      effects: {
        sessionId: `session-${executionId}`,
        executionId,
      },
      stop: (reason) => {
        record({ kind: 'stop', executionId, reason });
        return Promise.resolve();
      },
    });
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.use({ catalogEntry: { kind: 'system', id: 'orders' } });

test('starts the automatic sandbox even without destructuring its fixture', () => {
  playwrightExpect(true).toBe(true);
});

test('second physical attempt', ({ effects, sandbox }) => {
  playwrightExpect(sandbox.catalogEntry).toMatchObject({ id: 'orders', kind: 'system' });
  playwrightExpect(effects.executionId).toBe(sandbox.executionId);
});

test('retry gets a new physical attempt', ({ sandbox }, testInfo) => {
  playwrightExpect(sandbox.executionId).toBeTruthy();
  playwrightExpect(testInfo.retry).toBe(1);
});
