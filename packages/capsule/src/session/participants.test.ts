import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ComposeObservationSnapshot } from '@suites/blackbox-sandbox';
import { afterEach, describe, expect, it } from 'vitest';

import { readCapsuleProgress } from '../progress/store.js';
import {
  admitCapsuleRecord,
  capsuleSessionDirectory,
  type CapsuleSessionRecord,
} from '../records.js';
import { checkCapsuleParticipants, exitedParticipants } from './participants.js';

const roots: string[] = [];
const sessionId = 'quiet-river-ada';

function container(participant: string, service: string) {
  return {
    participant,
    service,
    containerId: `${participant}-id`,
    containerName: `${service}-1`,
    host: 'localhost',
    networkNames: ['net'],
  };
}

const containers = [
  container('api', 'orders-api'),
  container('db', 'orders-db'),
  container('cache', 'orders-cache'),
];

function observed(
  participant: string,
  state: ComposeObservationSnapshot['containers'][number]['state'],
  exitCode: number | null,
) {
  return {
    service: participant,
    containerId: `${participant}-id`,
    containerName: `${participant}-1`,
    state,
    health: 'not-configured' as const,
    termination:
      exitCode === null ? { kind: 'none' as const } : { kind: 'exited' as const, exitCode },
  };
}

// api runs, db exited with 137, cache's container is gone.
const snapshot = {
  containers: [observed('api', 'running', null), observed('db', 'exited', 137)],
  resources: [],
} satisfies ComposeObservationSnapshot;

async function fixture(state: CapsuleSessionRecord['state']) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-participants-'));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  const admittedAt = new Date().toISOString();
  await admitCapsuleRecord({
    projectDirectory,
    record: {
      schemaVersion: 1,
      sessionId,
      executionId: '00000000-0000-4000-8000-000000000001',
      system: 'orders',
      title: 'Orders experiment',
      description: { kind: 'omitted' },
      state,
      revision: 0,
      admittedAt,
      updatedAt: admittedAt,
      manager: { kind: 'not-started' },
      socketPath: join(projectDirectory, 'missing.sock'),
      entrypoint:
        state === 'running'
          ? {
              kind: 'available',
              value: { url: 'http://localhost:1', host: 'localhost', port: 1, protocol: 'http' },
            }
          : { kind: 'unavailable' },
      containers,
      cleanup: state === 'stopped' ? { kind: 'complete' } : { kind: 'not-attempted' },
      failure: { kind: 'none' },
      composeProject: { kind: 'available', value: 'bb-orders' },
      artifactRoot: capsuleSessionDirectory({ projectDirectory, sessionId }),
      networks: [],
      volumes: [],
      readiness:
        state === 'running'
          ? {
              kind: 'available',
              value: { url: 'http://localhost:1/', status: 'ready', durationMs: 1 },
            }
          : { kind: 'unavailable' },
    },
  });
  return projectDirectory;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('exitedParticipants', () => {
  it('reports exited and dead containers with their exit code, and missing ones without', () => {
    const dead = { ...snapshot, containers: [observed('api', 'dead', 1), ...snapshot.containers] };
    expect(exitedParticipants(containers, dead)).toEqual([
      expect.objectContaining({ participant: 'api', state: 'dead', exitCode: 1 }),
      expect.objectContaining({ participant: 'db', state: 'exited', exitCode: 137 }),
      expect.objectContaining({ participant: 'cache', state: 'missing', exitCode: null }),
    ]);
  });

  it('reports nothing while every participant runs', () => {
    const running = {
      containers: containers.map((item) => observed(item.participant, 'running', null)),
      resources: [],
    };
    expect(exitedParticipants(containers, running)).toEqual([]);
  });
});

describe('checkCapsuleParticipants', () => {
  it('queries the recorded Compose project and records each exit once as progress', async () => {
    const projectDirectory = await fixture('running');
    const projects: string[] = [];
    const inspect = ({ projectName }: { readonly projectName: string }) => {
      projects.push(projectName);
      return Promise.resolve(snapshot);
    };
    const first = await checkCapsuleParticipants({ projectDirectory, sessionId }, inspect);
    const second = await checkCapsuleParticipants({ projectDirectory, sessionId }, inspect);
    expect(projects).toEqual(['bb-orders', 'bb-orders']);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      kind: 'participants-checked',
      exited: [
        { participant: 'db', exitCode: 137 },
        { participant: 'cache', state: 'missing' },
      ],
    });
    const events = await readCapsuleProgress({ projectDirectory, sessionId });
    expect(events.map((event) => [event.kind, event.stage, event.sequence])).toEqual([
      ['participant-exited', 'running', 1],
      ['participant-exited', 'running', 2],
    ]);
    expect(events[0]).toMatchObject({ containerId: 'db-id', state: 'exited', exitCode: 137 });
  });

  it('does not query Docker for a capsule that is not running', async () => {
    const projectDirectory = await fixture('stopped');
    const inspect = () => Promise.reject(new Error('must not be called'));
    await expect(
      checkCapsuleParticipants({ projectDirectory, sessionId }, inspect),
    ).resolves.toEqual({
      kind: 'participants-not-running',
      state: 'stopped',
    });
  });

  it('turns a failed Docker query into an unavailable result instead of throwing', async () => {
    const projectDirectory = await fixture('running');
    const inspect = () => Promise.reject(new Error('docker socket refused'));
    await expect(
      checkCapsuleParticipants({ projectDirectory, sessionId }, inspect),
    ).resolves.toEqual({
      kind: 'participants-unavailable',
      message: 'docker socket refused',
    });
  });
});
