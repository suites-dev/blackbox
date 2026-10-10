import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeProjectName,
  sandboxRecordPath,
  type ActiveSandboxRecord,
  type RecoverSandboxInput,
  type SandboxRecoveryResult,
} from '@suites/blackbox-sandbox';
import { afterEach, expect, it } from 'vitest';

import type { BlackboxAttemptRuntime } from '../runtime/acquisition.js';
import { silentProgress } from '../reporting/events.js';
import { acquireWithinTestTimeout } from './timeouts.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

// Benchmark F19: with --timeout=5000 the acquisition outlived the test timeout and its
// 30 s cleanup window, and the worker exited with the attempt record still `starting`.
async function abandonedStart(input: { readonly recorded: boolean }) {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-abandoned-'));
  directories.push(artifactDirectory);
  const sandboxId = 'playwright-abandoned-execution';
  const runtime = {
    async start(request) {
      if (input.recorded) {
        const starting = {
          schemaVersion: 1,
          sandboxId,
          projectName: composeProjectName({ sandboxId }),
          composeFiles: ['compose.yaml'],
          state: 'starting',
          revision: 1,
          admittedAt: '2026-10-05T22:30:00.000Z',
          updatedAt: '2026-10-05T22:30:00.000Z',
        } satisfies ActiveSandboxRecord;
        await writeFile(
          sandboxRecordPath({ recordDirectory: request.artifactDirectory, sandboxId }),
          `${JSON.stringify(starting)}\n`,
        );
      }
      // Compose is still starting when the test timeout and the cleanup window end.
      return new Promise<never>(() => undefined);
    },
  } satisfies BlackboxAttemptRuntime;
  const recoveries: RecoverSandboxInput[] = [];
  const acquire = (recovery: SandboxRecoveryResult | Error) =>
    acquireWithinTestTimeout({
      runtime,
      testInfo: { timeout: 20 },
      cleanupTimeoutMs: 30,
      recoverSandbox: (recover) => {
        recoveries.push(recover);
        return recovery instanceof Error ? Promise.reject(recovery) : Promise.resolve(recovery);
      },
      request: {
        selection: { kind: 'system', id: 'login-slice' },
        configFile: join(artifactDirectory, 'blackbox.config.yaml'),
        environment: {},
        artifactDirectory,
        progress: silentProgress,
      },
    });
  return { acquire, artifactDirectory, sandboxId, recoveries };
}

const recovered = {
  kind: 'sandbox-recovered',
  record: {
    schemaVersion: 1,
    sandboxId: 'playwright-abandoned-execution',
    projectName: composeProjectName({ sandboxId: 'playwright-abandoned-execution' }),
    composeFiles: ['compose.yaml'],
    state: 'completed',
    revision: 2,
    admittedAt: '2026-10-05T22:30:00.000Z',
    updatedAt: '2026-10-05T22:31:00.000Z',
    stopReason: 'interrupted',
    cleanup: 'complete',
  },
} satisfies SandboxRecoveryResult;

it('recovers the sandbox an abandoned acquisition left starting', async () => {
  const fixture = await abandonedStart({ recorded: true });

  await expect(fixture.acquire(recovered)).rejects.toMatchObject({
    name: 'AggregateError',
    message:
      'Blackbox sandbox acquisition cleanup did not settle within 30ms; ' +
      'the abandoned sandbox was recovered',
    errors: [
      { message: 'Blackbox sandbox acquisition exceeded the Playwright test timeout of 20ms' },
    ],
  });
  expect(fixture.recoveries).toEqual([
    {
      recordDirectory: fixture.artifactDirectory,
      sandboxId: fixture.sandboxId,
      timeoutMs: 30,
    },
  ]);
});

it('reports a recovery that fails alongside the acquisition timeout', async () => {
  const fixture = await abandonedStart({ recorded: true });

  await expect(
    fixture.acquire({
      kind: 'sandbox-recovery-failed',
      error: { name: 'Error', message: 'Docker unavailable' },
      record: {
        ...recovered.record,
        state: 'stop-failed',
        primaryError: { name: 'Error', message: 'Docker unavailable' },
        cleanup: { kind: 'failed', error: { name: 'Error', message: 'Docker unavailable' } },
      },
    }),
  ).rejects.toMatchObject({
    message: expect.stringMatching(/recovering the abandoned sandbox also failed$/u) as unknown,
    errors: [
      { message: 'Blackbox sandbox acquisition exceeded the Playwright test timeout of 20ms' },
      {
        message:
          'Sandbox playwright-abandoned-execution recovery cleanup failed: Docker unavailable',
      },
    ],
  });
  await expect(fixture.acquire(new Error('record unreadable'))).rejects.toMatchObject({
    errors: [expect.anything(), { message: 'record unreadable' }],
  });
});

it('recovers nothing when the acquisition never recorded a sandbox', async () => {
  const fixture = await abandonedStart({ recorded: false });

  await expect(fixture.acquire(recovered)).rejects.toMatchObject({
    name: 'AggregateError',
  });
  expect(fixture.recoveries).toEqual([]);
});
