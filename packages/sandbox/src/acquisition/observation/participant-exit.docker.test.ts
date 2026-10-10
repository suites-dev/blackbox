import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { composeProjectName, readSandboxRecord, startSandbox } from '../../index.js';
import type { SandboxInput } from '../../model/input.js';
import { resourcesForProjects } from '../docker-proof/docker-inspection.fixture.js';

// Benchmark F11: a "stopped" fault profile made ts-price-service exit with code 0
// while the other participants were still starting, and acquisition failed only
// after 155 s with "Cannot get container ... as it is not running".
async function exitingParticipantFixture() {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'sandbox-participant-exit-docker-'));
  await writeFile(
    join(projectDirectory, 'compose.yaml'),
    `services:
  route:
    image: alpine:latest
    command: ["sleep", "3600"]
  price:
    image: alpine:latest
    command: ["/bin/sh", "-c", "sleep 2; exit 0"]
`,
  );
  const sandbox = {
    sandboxId: `participant-exit-${randomUUID()}`,
    projectDirectory,
    composeFiles: ['compose.yaml'],
    recordDirectory: join(projectDirectory, 'records'),
    environment: {},
    serviceSelection: { kind: 'selected', services: ['route', 'price'] },
    // Nothing listens on this port, so startup would wait for the whole timeout.
    endpoints: [{ name: 'entrypoint', service: 'route', containerPort: 8080 }],
    startupTimeoutMs: 90_000,
    stopTimeoutMs: 10_000,
    telemetry: { kind: 'disabled' },
  } satisfies SandboxInput;
  return { sandbox, projectName: composeProjectName(sandbox) };
}

describe.skipIf(process.env.BLACKBOX_SANDBOX_DOCKER_TEST !== '1')(
  'sandbox startup with a participant that exits',
  () => {
    it('fails as soon as the participant exits, naming it and its exit code', async () => {
      const input = await exitingParticipantFixture();
      const started = Date.now();
      try {
        await expect(
          startSandbox({ sandbox: input.sandbox, progress: { kind: 'silent' } }),
        ).rejects.toMatchObject({
          name: 'SandboxStartError',
          message:
            'Sandbox startup failed: Participant "price" exited during Sandbox startup ' +
            'with exit code 0; a selected participant must keep running',
          failure: { kind: 'start-failed', record: { kind: 'written' } },
        });
        expect(Date.now() - started).toBeLessThan(45_000);
        expect(await readSandboxRecord(input.sandbox)).toMatchObject({ state: 'start-failed' });
        expect(await resourcesForProjects({ projectNames: [input.projectName] })).toEqual({
          containers: [],
          networks: [],
          volumes: [],
        });
      } finally {
        await promisify(execFile)(
          'docker',
          [
            'compose',
            '--project-name',
            input.projectName,
            '-f',
            join(input.sandbox.projectDirectory, 'compose.yaml'),
            'down',
            '--volumes',
            '--remove-orphans',
          ],
          { timeout: 20_000 },
        );
        await rm(input.sandbox.projectDirectory, { recursive: true, force: true });
      }
    }, 150_000);
  },
);
