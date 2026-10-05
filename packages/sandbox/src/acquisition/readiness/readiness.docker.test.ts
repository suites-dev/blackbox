import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { composeProjectName, startSandbox } from '../../sandbox.js';
import type { SandboxInput } from '../../model/input.js';
import { resourcesForProjects } from '../docker-proof/docker-inspection.fixture.js';

// nginx listens at once; the health check only passes once /tmp/ready exists,
// which is the opposite order from the startup-progress fixture.
async function lateHealthFixture(input: { readonly healthyAfterSeconds: number }) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'sandbox-readiness-docker-'));
  await writeFile(
    join(projectDirectory, 'compose.yaml'),
    `services:
  api:
    image: nginx:alpine
    command: ["/bin/sh", "-c", "(sleep ${input.healthyAfterSeconds}; touch /tmp/ready) & exec nginx -g 'daemon off;'"]
    healthcheck:
      test: ["CMD", "test", "-f", "/tmp/ready"]
      interval: 1s
      timeout: 1s
      retries: 60
`,
  );
  const sandbox = {
    sandboxId: `readiness-${randomUUID()}`,
    projectDirectory,
    composeFiles: ['compose.yaml'],
    recordDirectory: join(projectDirectory, 'records'),
    environment: {},
    serviceSelection: { kind: 'selected', services: ['api'] },
    endpoints: [{ name: 'http', service: 'api', containerPort: 80 }],
    startupTimeoutMs: 2_000,
    stopTimeoutMs: 10_000,
    telemetry: { kind: 'disabled' },
  } satisfies SandboxInput;
  return { sandbox, projectName: composeProjectName(sandbox) };
}

describe.skipIf(process.env.BLACKBOX_SANDBOX_DOCKER_TEST !== '1')(
  'sandbox startup readiness with a health check',
  () => {
    it('is not ready while the health check fails even though the endpoint port listens', async () => {
      const input = await lateHealthFixture({ healthyAfterSeconds: 30 });
      try {
        await expect(
          startSandbox({ sandbox: input.sandbox, progress: { kind: 'silent' } }),
        ).rejects.toMatchObject({
          name: 'SandboxStartError',
        });
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
    }, 60_000);
  },
);
