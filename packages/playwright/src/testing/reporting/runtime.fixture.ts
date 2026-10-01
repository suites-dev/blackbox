import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { BlackboxAttemptInput, BlackboxAttemptRuntime } from '../../runtime/acquisition.js';

export async function waitForReporter(file = 'reporter-observed-startup'): Promise<void> {
  // The parent launches this isolated process in its own mkdtemp directory.
  const output = process.cwd();
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await access(join(output, file));
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error('Reporter did not publish progress while acquisition was blocked');
}

function runningAttempt(input: BlackboxAttemptInput) {
  if (input.selection.kind === 'unselected') {
    throw new Error('Missing selection');
  }
  const executionId = randomUUID();
  return {
    sandbox: {
      sandboxId: executionId,
      executionId,
      catalogEntry: input.selection,
      projectName: `test-${executionId}`,
      artifactDirectory: input.artifactDirectory,
      entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
      containers: new Map(),
    },
    effects: { sessionId: executionId, executionId },
    telemetry: {
      sessionId: executionId,
      executionId,
      inspect: () => Promise.resolve({ kind: 'disabled' as const }),
      read: () =>
        Promise.resolve({
          kind: 'collector-session-found' as const,
          lifecycle: {
            schemaVersion: 1 as const,
            sessionId: executionId,
            executionId,
            revision: 1,
            runs: [],
            telemetry: {
              status: 'not-received' as const,
              acceptedRequests: 0 as const,
              acceptedSpans: 0 as const,
              lastReceivedAt: null,
            },
          },
          fragments: [],
          traceIds: [],
        }),
      readTrace: () => Promise.reject(new Error('not used')),
    },
    stop() {
      if (input.selection.kind !== 'unselected' && input.selection.id === 'cleanup-failure') {
        return Promise.reject(new Error('synthetic cleanup failure'));
      }
      return Promise.resolve();
    },
  };
}

export const runtime = {
  async start(input) {
    if (input.configFile !== join(import.meta.dirname, 'catalog/custom.yaml')) {
      throw new Error(
        `Config was not resolved relative to playwright.config.ts: ${input.configFile}`,
      );
    }
    input.progress.emit('acquisition', 'started', 'waiting for reporter handshake');
    input.progress.emit('container', 'info', 'api\u001b[2J: starting; token=synthetic-secret');
    await waitForReporter();
    if (input.selection.kind !== 'unselected' && input.selection.id === 'setup-failure') {
      throw new Error('synthetic setup failure');
    }
    input.progress.emit('acquisition', 'completed', 'containers acquired');
    return runningAttempt(input);
  },
} satisfies BlackboxAttemptRuntime;
