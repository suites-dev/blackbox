import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { composeProjectName, readSandboxRecord, startSandbox } from '../../index.js';
import { resourcesForProjects } from './docker-inspection.fixture.js';

const dockerEnabled = process.env.BLACKBOX_SANDBOX_DOCKER_TEST === '1';
const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures');

describe.skipIf(!dockerEnabled)('Docker cleanup of a participant that ignores SIGTERM', () => {
  it('kills it after the stop grace and completes within the stop budget', async () => {
    const sandboxId = `stop-grace-${randomUUID()}`;
    const recordDirectory = await mkdtemp(join(tmpdir(), 'blackbox-stop-grace-'));
    const stopTimeoutMs = 30_000;
    try {
      const handle = await startSandbox({
        sandbox: {
          sandboxId,
          projectDirectory,
          composeFiles: ['sigterm-ignoring.compose.yaml'],
          recordDirectory,
          environment: {},
          serviceSelection: { kind: 'selected', services: ['stubborn'] },
          endpoints: [],
          startupTimeoutMs: 60_000,
          stopTimeoutMs,
          telemetry: { kind: 'disabled' },
        },
        progress: { kind: 'silent' },
      });
      const started = Date.now();
      // Before the fix Docker was given the whole budget as stop grace, so
      // this stop always hit the cleanup deadline first.
      await expect(handle.stop({ reason: 'completed' })).resolves.toMatchObject({
        cleanup: 'complete',
      });
      expect(Date.now() - started).toBeLessThan(stopTimeoutMs);
      expect(await readSandboxRecord({ recordDirectory, sandboxId })).toMatchObject({
        state: 'completed',
        cleanup: 'complete',
      });
      const remaining = await resourcesForProjects({
        projectNames: [composeProjectName({ sandboxId })],
      });
      expect(remaining.containers).toEqual([]);
      expect(remaining.networks).toEqual([]);
    } finally {
      // Removes what a failed stop left behind; a no-op after a complete one.
      await promisify(execFile)(
        'docker',
        ['compose', '--project-name', composeProjectName({ sandboxId }), '-f',
          join(projectDirectory, 'sigterm-ignoring.compose.yaml'), 'down', '--timeout', '0'],
        { timeout: 30_000 },
      );
      await rm(recordDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
