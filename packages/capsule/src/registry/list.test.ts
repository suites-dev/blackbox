import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { admitCapsuleRecord, capsuleRuntimeRoot, type CapsuleSessionRecord } from '../records.js';
import { listCapsuleSessions } from './list.js';

const roots: string[] = [];

async function project(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'capsule-registry-'));
  roots.push(directory);
  await writeFile(join(directory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  return realpath(directory);
}

function record(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly admittedAt: string;
}): CapsuleSessionRecord {
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    executionId: '00000000-0000-4000-8000-000000000001',
    system: 'orders',
    title: undefined,
    description: undefined,
    state: 'stopped',
    revision: 2,
    admittedAt: input.admittedAt,
    updatedAt: input.admittedAt,
    managerPid: undefined,
    socketPath: join(input.projectDirectory, '.blackbox', 's', 'private.sock'),
    entrypoint: undefined,
    containers: [],
    cleanup: { kind: 'complete' },
    error: undefined,
    composeProject: undefined,
    artifactRoot: join(
      input.projectDirectory,
      '.blackbox',
      'experiments',
      `capsule-${input.sessionId}`,
    ),
    networks: [],
    volumes: [],
    readiness: undefined,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Capsule session registry summaries', () => {
  it('returns an empty registry when no experiment directory exists', async () => {
    const projectDirectory = await project();
    await expect(listCapsuleSessions({ projectDirectory })).resolves.toEqual({
      kind: 'capsule-session-registry',
      projectDirectory: await realpath(projectDirectory),
      entries: [],
    });
  });

  it('lists exact summaries newest first without private process identity', async () => {
    const projectDirectory = await project();
    await admitCapsuleRecord({
      projectDirectory,
      record: record({ projectDirectory, sessionId: 'quiet-river-ada', admittedAt: '2026-01-01T00:00:00.000Z' }),
    });
    await admitCapsuleRecord({
      projectDirectory,
      record: record({ projectDirectory, sessionId: 'flying-suite-jacob', admittedAt: '2026-02-01T00:00:00.000Z' }),
    });
    const result = await listCapsuleSessions({ projectDirectory });
    expect(result).toMatchObject({
      kind: 'capsule-session-registry',
      entries: [
        { kind: 'capsule-session-summary', summary: { sessionId: 'flying-suite-jacob' } },
        { kind: 'capsule-session-summary', summary: { sessionId: 'quiet-river-ada' } },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('executionId');
    expect(JSON.stringify(result)).not.toContain('socketPath');
  });
});

describe('Capsule session registry failures', () => {
  it('retains missing, corrupt, and mismatched entries as explicit outcomes', async () => {
    const projectDirectory = await project();
    const root = capsuleRuntimeRoot({ projectDirectory });
    await mkdir(join(root, 'capsule-calm-river-maya'), { recursive: true });
    await mkdir(join(root, 'capsule-bright-comet-zoe'), { recursive: true });
    await writeFile(join(root, 'capsule-bright-comet-zoe', 'session.json'), '{bad-json');
    await mkdir(join(root, 'capsule-rapid-harbor-alex'), { recursive: true });
    await writeFile(
      join(root, 'capsule-rapid-harbor-alex', 'session.json'),
      JSON.stringify(record({ projectDirectory, sessionId: 'quiet-river-ada', admittedAt: '2026-01-01T00:00:00.000Z' })),
    );
    await mkdir(join(root, 'unrelated-directory'));
    const result = await listCapsuleSessions({ projectDirectory });
    expect(result).toMatchObject({
      kind: 'capsule-session-registry',
      entries: [
        { kind: 'capsule-session-corrupt', directoryName: 'capsule-bright-comet-zoe', failure: { kind: 'record-corrupt' } },
        { kind: 'capsule-session-corrupt', directoryName: 'capsule-calm-river-maya', failure: { kind: 'record-missing' } },
        { kind: 'capsule-session-corrupt', directoryName: 'capsule-rapid-harbor-alex', failure: { kind: 'identity-mismatch' } },
      ],
    });
  });

  it('returns a registry failure when the project itself cannot be resolved', async () => {
    await expect(listCapsuleSessions({ projectDirectory: 'relative' })).resolves.toMatchObject({
      kind: 'capsule-registry-failed',
      error: { message: 'projectDirectory must be absolute' },
    });
  });
});
