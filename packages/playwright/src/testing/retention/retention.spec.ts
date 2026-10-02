import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';

const runtime = {
  async start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    const sandboxId = `playwright-${randomUUID()}`;
    input.progress.identify(sandboxId);
    // Stands in for the sandbox record and telemetry that acquisition writes here.
    await mkdir(input.artifactDirectory, { recursive: true });
    await writeFile(
      join(input.artifactDirectory, `${sandboxId}.json`),
      JSON.stringify({ sandboxId }),
    );
    process.stdout.write(
      `BLACKBOX_PLAYWRIGHT_EVENT ${JSON.stringify({ kind: 'start', sandboxId })}\n`,
    );
    return {
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
      stop: () => Promise.resolve(),
    };
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.use({ catalogEntry: { kind: 'system', id: 'orders' } });

test('retains its attempt when asked to', ({ sandbox }) => {
  playwrightExpect(sandbox.sandboxId).toMatch(/^playwright-/u);
});
