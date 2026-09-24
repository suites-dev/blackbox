import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { composeProjectName, readSandboxRecord, startSandbox } from '../../index.js';
import type { SandboxInput } from '../../types.js';
import type { SandboxProgressEvent } from '../progress.js';
import { resourcesForProjects } from './docker-inspection.fixture.js';

const dockerEnabled = process.env.BLACKBOX_SANDBOX_DOCKER_TEST === '1';
const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures');

async function testInput(): Promise<SandboxInput> {
  const sandboxId = `failure-proof-${randomUUID()}`;
  return {
    sandboxId,
    projectDirectory,
    composeFiles: ['concurrency.compose.yaml'],
    recordDirectory: await mkdtemp(join(tmpdir(), 'blackbox-acquisition-failure-')),
    environment: { SANDBOX_ID: sandboxId },
    serviceSelection: { kind: 'selected', services: ['echo'] },
    endpoints: [{ name: 'unmapped', service: 'echo', containerPort: 65000 }],
    startupTimeoutMs: 60_000,
    stopTimeoutMs: 20_000,
    telemetry: { kind: 'disabled' },
  };
}

async function ownedFallbackCleanup(input: SandboxInput): Promise<void> {
  const projectName = composeProjectName(input);
  const remaining = await resourcesForProjects({ projectNames: [projectName] });
  if (remaining.containers.length + remaining.networks.length + remaining.volumes.length > 0) {
    await promisify(execFile)(
      'docker',
      [
        'compose',
        '--project-name',
        projectName,
        '-f',
        join(projectDirectory, 'concurrency.compose.yaml'),
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      { env: { ...process.env, SANDBOX_ID: input.sandboxId }, timeout: 30_000 },
    );
  }
  await rm(input.recordDirectory, { recursive: true, force: true });
}

describe.skipIf(!dockerEnabled)('Docker startup failure cleanup', () => {
  it('removes acquired containers, networks, and volumes when endpoint resolution fails', async () => {
    const input = await testInput();
    const projectName = composeProjectName(input);
    const events: SandboxProgressEvent[] = [];
    try {
      await expect(
        startSandbox({
          sandbox: input,
          progress: { kind: 'events', sink: { emit: (event) => events.push(event) } },
        }),
      ).rejects.toMatchObject({
        name: 'SandboxStartError',
        failure: {
          kind: 'start-failed',
          cleanup: { kind: 'complete' },
          record: { kind: 'written' },
        },
      });
      expect(await readSandboxRecord(input)).toMatchObject({
        sandboxId: input.sandboxId,
        projectName,
        state: 'start-failed',
        cleanup: { kind: 'complete' },
      });
      expect(
        events.filter(({ kind }) => kind !== 'acquisition-observation').map(({ kind }) => kind),
      ).toEqual(['acquisition-started', 'acquisition-failed']);
      expect(await resourcesForProjects({ projectNames: [projectName] })).toEqual({
        containers: [],
        networks: [],
        volumes: [],
      });
    } finally {
      await ownedFallbackCleanup(input);
    }
  }, 90_000);
});
