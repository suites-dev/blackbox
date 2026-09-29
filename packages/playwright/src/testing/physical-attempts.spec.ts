import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../fixtures.js';
import type { BlackboxAttemptRuntime } from '../runtime/acquisition.js';

function requiredEventLog(): string {
  const value = process.env.BLACKBOX_PLAYWRIGHT_EVENT_LOG;
  if (value === undefined) {
    throw new Error('BLACKBOX_PLAYWRIGHT_EVENT_LOG is required');
  }
  return value;
}

const eventLog = requiredEventLog();

async function record(value: object): Promise<void> {
  await appendFile(eventLog, `${JSON.stringify(value)}\n`, 'utf8');
}

const runtime = {
  async start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    const executionId = randomUUID();
    await record({
      kind: 'start',
      executionId,
      artifactDirectory: input.artifactDirectory,
      selection: input.selection,
    });
    return {
      sandbox: {
        sandboxId: executionId,
        executionId,
        catalogEntry: {
          id: input.selection.id,
          kind: input.selection.kind,
          declaredIsolation: { kind: 'per-test' },
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
      stop: async (reason) => record({ kind: 'stop', executionId, reason }),
    };
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.use({ catalogEntry: { kind: 'system', id: 'orders' } });

test('starts the automatic sandbox even without destructuring its fixture', () => {
  playwrightExpect(true).toBe(true);
});

test('second physical attempt', ({ sandbox }) => {
  playwrightExpect(sandbox.catalogEntry).toMatchObject({ id: 'orders', kind: 'system' });
});

test('retry gets a new physical attempt', ({ sandbox }, testInfo) => {
  playwrightExpect(sandbox.executionId).toBeTruthy();
  playwrightExpect(testInfo.retry).toBe(1);
});
