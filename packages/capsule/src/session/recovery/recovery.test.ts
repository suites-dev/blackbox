import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  admitCapsuleRecord,
  readCapsuleActivities,
  readCapsuleRecord,
  writeCapsuleActivities,
  type CapsuleSessionRecord,
} from '../../records.js';
import { completedHostActivity } from '../../persistence/testing/record.fixture.js';
import {
  reconcileDeadCapsuleManager,
  reconcileDeadCapsuleManagerWithPorts,
  type CapsuleManagerRecoveryPorts,
} from './index.js';
import {
  completedAt,
  noSandboxRecord,
  processError,
  runningActivity,
  runningRecord,
} from './recovery.fixture.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('dead Capsule manager reconciliation', () => {
  it('interrupts running activities and records completed cleanup', async () => {
    let record = runningRecord('/project');
    let activities = [completedHostActivity(), runningActivity()];
    const writes: string[] = [];
    const ports = {
      now: () => completedAt,
      signal: () => { throw processError('ESRCH'); },
      probeManager: () => Promise.resolve({ kind: 'manager-instance-exact' }),
      readRecord: () => Promise.resolve(record),
      readActivities: () => Promise.resolve(activities),
      writeActivities: (input) => {
        writes.push('activities');
        activities = [...input.activities];
        return Promise.resolve();
      },
      writeRecord: (input) => {
        writes.push('session');
        record = input.record;
        return Promise.resolve();
      },
      recoverSandbox: noSandboxRecord,
    } satisfies CapsuleManagerRecoveryPorts;

    await expect(
      reconcileDeadCapsuleManagerWithPorts(
        { projectDirectory: '/project', sessionId: record.sessionId },
        ports,
      ),
    ).resolves.toMatchObject({
      kind: 'capsule-manager-reconciled',
      interruptedActivityIds: ['activity-running'],
      record: {
        state: 'manager-failed',
        revision: 5,
        cleanup: { kind: 'complete' },
        failure: { kind: 'recorded', error: { name: 'CapsuleManagerUnavailable' } },
      },
    });
    expect(writes).toEqual(['activities', 'session']);
    expect(activities[1]).toMatchObject({
      kind: 'interrupted',
      completedAt,
      telemetry: {
        kind: 'telemetry-execution-scope-completed-v1',
        endedAt: completedAt,
        result: { kind: 'telemetry-scope-interrupted' },
      },
      error: { name: 'CapsuleManagerUnavailable' },
    });

    await expect(
      reconcileDeadCapsuleManagerWithPorts(
        { projectDirectory: '/project', sessionId: record.sessionId },
        ports,
      ),
    ).resolves.toMatchObject({
      kind: 'capsule-manager-reconciliation-skipped',
      reason: 'terminal-session',
    });
    expect(writes).toEqual(['activities', 'session']);
  });

});

describe('Capsule manager reconciliation admission', () => {
  it('requires a nonterminal session with recorded manager ownership', async () => {
    const base = runningRecord('/project');
    const writes = vi.fn<CapsuleManagerRecoveryPorts['writeRecord']>();
    for (const record of [
      { ...base, state: 'stopped', cleanup: { kind: 'complete' } },
      { ...base, state: 'start-failed' },
      { ...base, state: 'manager-failed' },
      { ...base, state: 'manager-starting', manager: { kind: 'not-started' } },
    ] satisfies CapsuleSessionRecord[]) {
      const result = await reconcileDeadCapsuleManagerWithPorts(
        { projectDirectory: '/project', sessionId: record.sessionId },
        {
          now: () => completedAt,
          signal: () => { throw processError('ESRCH'); },
          probeManager: () => Promise.resolve({ kind: 'manager-instance-exact' }),
          readRecord: () => Promise.resolve(record),
          readActivities: () => Promise.resolve([runningActivity()]),
          writeActivities: () => Promise.resolve(),
          writeRecord: writes,
          recoverSandbox: noSandboxRecord,
        },
      );
      expect(result.kind).toBe('capsule-manager-reconciliation-skipped');
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it('retains a new recovery failure when a stop-failed manager is dead', async () => {
    const initialRecord = {
      ...runningRecord('/project'),
      state: 'stop-failed',
      cleanup: {
        kind: 'failed',
        error: { name: 'DockerError', message: 'resource release failed' },
      },
    } satisfies CapsuleSessionRecord;
    let record: CapsuleSessionRecord = initialRecord;
    const result = await reconcileDeadCapsuleManagerWithPorts(
      { projectDirectory: '/project', sessionId: record.sessionId },
      {
        now: () => completedAt,
        signal: () => { throw processError('ESRCH'); },
        probeManager: () => Promise.resolve({ kind: 'manager-instance-exact' }),
        readRecord: () => Promise.resolve(record),
        readActivities: () => Promise.resolve([]),
        writeActivities: () => Promise.resolve(),
        writeRecord: (input) => {
          record = input.record;
          return Promise.resolve();
        },
        recoverSandbox: () => Promise.reject(new Error('recovery still unavailable')),
      },
    );
    expect(result).toMatchObject({
      kind: 'capsule-manager-reconciled',
      record: {
        state: 'manager-failed',
        cleanup: {
          kind: 'failed',
          error: { name: 'Error', message: 'recovery still unavailable' },
        },
      },
    });
  });

});

describe('persisted Capsule manager reconciliation', () => {
  it('persists schema-valid interrupted telemetry and remains idempotent through real artifacts', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-recovery-'));
    roots.push(projectDirectory);
    const record = runningRecord(projectDirectory);
    await admitCapsuleRecord({ projectDirectory, record });
    await writeCapsuleActivities({
      projectDirectory,
      sessionId: record.sessionId,
      activities: [runningActivity()],
    });
    vi.spyOn(process, 'kill').mockImplementation(() => { throw processError('ESRCH'); });

    await expect(
      reconcileDeadCapsuleManager({ projectDirectory, sessionId: record.sessionId }),
    ).resolves.toMatchObject({ kind: 'capsule-manager-reconciled' });
    await expect(readCapsuleActivities({ projectDirectory, sessionId: record.sessionId }))
      .resolves.toMatchObject([{ kind: 'interrupted' }]);
    await expect(readCapsuleRecord({ projectDirectory, sessionId: record.sessionId }))
      .resolves.toMatchObject({ state: 'manager-failed', cleanup: { kind: 'complete' } });
    await expect(
      reconcileDeadCapsuleManager({ projectDirectory, sessionId: record.sessionId }),
    ).resolves.toMatchObject({
      kind: 'capsule-manager-reconciliation-skipped',
      reason: 'terminal-session',
    });
  });
});
