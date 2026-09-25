import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  admitCapsuleRecord,
  capsuleSessionDirectory,
  readCapsuleRecord,
  writeCapsuleRecord,
  type CapsuleSessionRecord,
} from '../records.js';
import { execCapsule, reportCapsule, stopCapsule } from './operations.js';

const roots: string[] = [];

async function sessionFixture(
  state: CapsuleSessionRecord['state'],
  selectedSessionId = 'quiet-river-ada',
) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-operations-'));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  const sessionId = selectedSessionId;
  const admittedAt = new Date().toISOString();
  const record = {
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
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: state === 'stopped' ? { kind: 'complete' } : { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot: capsuleSessionDirectory({ projectDirectory, sessionId }),
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  } satisfies CapsuleSessionRecord;
  await admitCapsuleRecord({ projectDirectory, record });
  return { projectDirectory, sessionId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Capsule exact-session failure unions', () => {
  it('reports missing, invalid-state, idempotent-stop, and IPC failures distinctly', async () => {
    const stopped = await sessionFixture('stopped');
    await expect(stopCapsule({ ...stopped, reason: 'completed' })).resolves.toMatchObject({
      kind: 'capsule-stopped',
      alreadyStopped: true,
    });
    await expect(
      execCapsule({
        ...stopped,
        name: { kind: 'omitted' },
        purpose: 'stimulus',
        target: { kind: 'host', argv: ['true'] },
      }),
    ).resolves.toMatchObject({
      kind: 'capsule-invalid-state',
      state: 'stopped',
    });
    await expect(reportCapsule(stopped)).resolves.toMatchObject({
      kind: 'capsule-report',
      document: { progress: [] },
    });
    await expect(
      reportCapsule({ projectDirectory: stopped.projectDirectory, sessionId: 'bright-comet-zoe' }),
    ).resolves.toMatchObject({ kind: 'capsule-not-found' });
    const running = await sessionFixture('running');
    await expect(
      execCapsule({
        ...running,
        name: { kind: 'omitted' },
        purpose: 'stimulus',
        target: { kind: 'host', argv: ['true'] },
      }),
    ).resolves.toMatchObject({
      kind: 'capsule-operation-failed',
      operation: 'exec',
    });
    const failedStop = await sessionFixture('stop-failed');
    await expect(stopCapsule({ ...failedStop, reason: 'failed' })).resolves.toMatchObject({
      kind: 'capsule-operation-failed',
      operation: 'stop',
    });
  });

  it('keeps legacy UUID-form session selectors readable', async () => {
    const legacy = await sessionFixture('stopped', 'capsule-9e9c6861-faf5-442d-96a1-274641d4c770');
    await expect(reportCapsule(legacy)).resolves.toMatchObject({
      kind: 'capsule-report',
      document: {
        session: { sessionId: 'capsule-9e9c6861-faf5-442d-96a1-274641d4c770' },
      },
    });
  });
});

describe('dead manager reader reconciliation', () => {
  it('reconciles before exec, stop, and report read session state', async () => {
    const session = await sessionFixture('manager-starting');
    const record = await readCapsuleRecord(session);
    await writeCapsuleRecord({
      projectDirectory: session.projectDirectory,
      record: { ...record, manager: { kind: 'started', pid: 42_424 } },
    });
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('dead'), { code: 'ESRCH' });
    });
    await expect(
      execCapsule({
        ...session,
        name: { kind: 'omitted' },
        purpose: 'inspection',
        target: { kind: 'host', argv: ['true'] },
      }),
    ).resolves.toMatchObject({ kind: 'capsule-invalid-state', state: 'manager-failed' });
    await expect(stopCapsule({ ...session, reason: 'failed' })).resolves.toMatchObject({
      kind: 'capsule-invalid-state',
      state: 'manager-failed',
    });
    await expect(reportCapsule(session)).resolves.toMatchObject({
      kind: 'capsule-report',
      document: {
        lifecycle: { kind: 'failed', retainedState: 'manager-failed' },
        cleanup: { kind: 'not-attempted' },
      },
    });
  });
});
