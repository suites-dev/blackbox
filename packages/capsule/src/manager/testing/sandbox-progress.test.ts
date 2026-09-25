import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogEntry } from '@suites/blackbox-catalog-internal';
import { expect, it } from 'vitest';
import { capsuleSessionDirectory } from '../../records.js';
import { capsuleProgressPath, readCapsuleProgress } from '../../progress/store.js';
import { sandboxProgressBridge } from '../sandbox-progress.js';

async function fixture() {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-observation-'));
  const bootstrap = {
    projectDirectory,
    sessionId: 'quiet-river-ada',
    executionId: 'execution',
    systemId: 'orders',
    environment: {},
  };
  await mkdir(capsuleSessionDirectory(bootstrap), { recursive: true });
  const entry = {
    kind: 'system',
    acquisition: { adapter: 'docker-compose@1', files: ['compose.yaml'] },
    isolation: { kind: 'per-test' },
    entrypoint: {
      participant: 'postgres',
      protocol: 'tcp',
      containerPort: 5432,
      readiness: { path: '/', timeoutMs: 1_000 },
    },
    participants: {
      postgres: {
        service: 'db',
        role: 'entrypoint',
        runtime: 'postgres',
        activation: { kind: 'unconfigured' },
      },
    },
    drivers: {},
    observation: {
      policyId: 'test',
      boundaries: [],
      requiredBoundaries: [],
      terminalObservationWindowMs: 0,
      redaction: { requestBodies: 'not-captured', headers: [], dynamicIdentifiers: 'none' },
    },
  } satisfies CatalogEntry;
  const bridge = sandboxProgressBridge({ bootstrap, entry });
  if (bridge.mode.kind !== 'events') {
    throw new Error('Must retain progress even without a terminal');
  }
  return {
    bootstrap,
    bridge,
    sink: bridge.mode.sink,
    base: { sandboxId: 'execution', projectName: 'owned', at: 'now' },
  };
}

it('persists early states in order, including Compose dependencies with no catalog participant', async () => {
  const input = await fixture();
  try {
    for (const service of ['db', 'dependency']) {
      input.sink.emit({
        ...input.base,
        kind: 'acquisition-observation',
        observation: {
          kind: 'service-state',
          container: {
            service,
            containerId: service,
            containerName: `owned-${service}`,
            state: 'running',
            health: 'starting',
            termination: { kind: 'none' },
          },
        },
      });
    }
    input.sink.emit({
      ...input.base,
      kind: 'acquisition-observation',
      observation: { kind: 'waiting', elapsedMs: 5000 },
    });
    await input.bridge.flush();
    const events = await readCapsuleProgress(input.bootstrap);
    expect(events).toMatchObject([
      {
        kind: 'acquisition-observation',
        sequence: 1,
        stage: 'acquisition',
        observation: { participant: 'postgres', container: { health: 'starting' } },
      },
      { kind: 'acquisition-observation', sequence: 2, observation: { participant: 'dependency' } },
      { kind: 'acquisition-observation', sequence: 3, observation: { kind: 'waiting' } },
    ]);
    expect(events.some((event) => event.kind === 'capsule-ready')).toBe(false);
  } finally {
    await rm(input.bootstrap.projectDirectory, { recursive: true, force: true });
  }
});

it('captures asynchronous durable-write errors and rejects flush without an unhandled rejection', async () => {
  const input = await fixture();
  try {
    await mkdir(capsuleProgressPath(input.bootstrap));
    input.sink.emit({
      ...input.base,
      kind: 'acquisition-observation',
      observation: { kind: 'waiting', elapsedMs: 0 },
    });
    input.sink.emit({
      ...input.base,
      kind: 'acquisition-observation',
      observation: { kind: 'waiting', elapsedMs: 5000 },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(input.bridge.flush()).rejects.toMatchObject({ code: 'EISDIR' });
  } finally {
    await rm(input.bootstrap.projectDirectory, { recursive: true, force: true });
  }
});
