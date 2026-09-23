import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { composeProjectName, startSandbox } from '../sandbox.js';
import type { SandboxHandle, SandboxInput } from '../types.js';
import type { SandboxProgressEvent } from './progress.js';
import { resourcesForProjects } from './docker-inspection.fixture.js';

async function fixture(input: { readonly delay: number; readonly timeout: number }) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'sandbox-progress-docker-'));
  await writeFile(join(projectDirectory, 'compose.yaml'), `services:
  api:
    image: nginx:alpine
    command: ["/bin/sh", "-c", "sleep ${input.delay}; exec nginx -g 'daemon off;'"]
    ports: ["80"]
    healthcheck:
      test: ["CMD", "true"]
      interval: 1s
      timeout: 1s
      retries: 2
    volumes: ["owned-data:/var/cache/blackbox-progress"]
volumes:
  owned-data:
`);
  const sandbox = {
    sandboxId: `progress-${randomUUID()}`, projectDirectory, composeFiles: ['compose.yaml'], recordDirectory: join(projectDirectory, 'records'),
    environment: {}, serviceSelection: { kind: 'selected', services: ['api'] }, endpoints: [{ name: 'http', service: 'api', containerPort: 80 }],
    startupTimeoutMs: input.timeout, stopTimeoutMs: 10_000,
  } satisfies SandboxInput;
  return { sandbox, projectName: composeProjectName(sandbox) };
}

async function cleanup(input: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  try {
    await promisify(execFile)('docker', ['compose', '--project-name', input.projectName, '-f', join(input.sandbox.projectDirectory, 'compose.yaml'), 'down', '--volumes', '--remove-orphans'], { timeout: 20_000 });
    expect(await resourcesForProjects({ projectNames: [input.projectName] })).toEqual({ containers: [], networks: [], volumes: [] });
  } finally { await rm(input.sandbox.projectDirectory, { recursive: true, force: true }); }
}

async function cleanupAll(input: { readonly inputs: readonly Awaited<ReturnType<typeof fixture>>[]; readonly handles: readonly SandboxHandle[] }): Promise<void> {
  const stops = await Promise.allSettled(input.handles.map((handle) => handle.stop({ reason: 'completed' })));
  const cleanups = await Promise.allSettled(input.inputs.map(cleanup));
  const failures = [...stops, ...cleanups].flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
  if (failures.length > 0) { throw new AggregateError(failures, 'Owned progress-proof cleanup failed'); }
}

function inspectEarlyEvents(input: { readonly events: readonly SandboxProgressEvent[]; readonly projectName: string }): void {
  const acquired = input.events.findIndex((event) => event.kind === 'containers-acquired');
  const observed = input.events.slice(0, acquired).flatMap((event) => event.kind === 'acquisition-observation' ? [event.observation] : []);
  expect(observed).toContainEqual(expect.objectContaining({ kind: 'service-state', container: expect.objectContaining({ state: 'running', health: 'healthy' }) }));
  expect(observed).toContainEqual(expect.objectContaining({ kind: 'resource-discovered', resource: expect.objectContaining({ kind: 'network' }) }));
  for (const event of observed) {
    if (event.kind === 'service-state') { expect(event.container.containerName).toBe(`${input.projectName}-api-1`); }
    if (event.kind === 'resource-discovered') { expect(event.resource.name).toMatch(new RegExp(`^${input.projectName}_`, 'u')); }
  }
}

describe.skipIf(process.env.BLACKBOX_SANDBOX_DOCKER_TEST !== '1')('live Compose acquisition progress', () => {
  it('observes two isolated projects before their delayed ports are ready and leaves no owned resources', async () => {
    const inputs = await Promise.all([fixture({ delay: 4, timeout: 20_000 }), fixture({ delay: 4, timeout: 20_000 })]);
    const handles: SandboxHandle[] = [];
    try {
      const proofs = await Promise.allSettled(inputs.map(async (input) => {
        const events: SandboxProgressEvent[] = [];
        const handle = await startSandbox({ sandbox: input.sandbox, progress: { kind: 'events', sink: { emit: (event) => events.push(event) } } });
        handles.push(handle);
        inspectEarlyEvents({ events, projectName: input.projectName });
        const count = events.length;
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(events).toHaveLength(count);
        return handle.endpoints.get('http')!.port;
      }));
      expect(proofs.every((proof) => proof.status === 'fulfilled'), JSON.stringify(proofs)).toBe(true);
      const ports = proofs.flatMap((proof) => proof.status === 'fulfilled' ? [proof.value] : []);
      expect(new Set(ports).size).toBe(2);
    } finally {
      await cleanupAll({ inputs, handles });
    }
  }, 60_000);

  it('stops observation when up fails and retains observed states before the failure', async () => {
    const input = await fixture({ delay: 20, timeout: 1500 });
    const events: SandboxProgressEvent[] = [];
    try {
      await expect(startSandbox({ sandbox: input.sandbox, progress: { kind: 'events', sink: { emit: (event) => events.push(event) } } })).rejects.toMatchObject({ name: 'SandboxStartError' });
      expect(events.some((event) => event.kind === 'acquisition-observation' && event.observation.kind === 'service-state')).toBe(true);
      expect(events.at(-1)).toMatchObject({ kind: 'acquisition-failed' });
      const count = events.length;
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(events).toHaveLength(count);
      expect(await resourcesForProjects({ projectNames: [input.projectName] })).toEqual({ containers: [], networks: [], volumes: [] });
    } finally { await cleanup(input); }
  }, 60_000);
});
