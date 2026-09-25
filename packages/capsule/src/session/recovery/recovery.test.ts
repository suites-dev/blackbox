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
import { activeTelemetry, completedHostActivity } from '../../persistence/testing/record.fixture.js';
import type { CapsuleActivityReport } from '../../types.js';
import {
  reconcileDeadCapsuleManager,
  reconcileDeadCapsuleManagerWithPorts,
  type CapsuleManagerRecoveryPorts,
} from './index.js';

const roots: string[] = [];
const completedAt = '2026-09-25T10:00:00.000Z';

function runningRecord(projectDirectory: string): CapsuleSessionRecord {
  const sessionId = 'quiet-river-ada';
  return {
    schemaVersion: 1,
    sessionId,
    executionId: '11111111-1111-4111-8111-111111111111',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'running',
    revision: 4,
    admittedAt: '2026-09-25T09:00:00.000Z',
    updatedAt: '2026-09-25T09:01:00.000Z',
    manager: { kind: 'started', pid: 42_424 },
    socketPath: join(projectDirectory, 'manager.sock'),
    entrypoint: {
      kind: 'available',
      value: { url: 'http://localhost:3000', host: 'localhost', port: 3000, protocol: 'http' },
    },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'available', value: 'bb-orders' },
    artifactRoot: join(projectDirectory, '.blackbox', 'experiments', `capsule-${sessionId}`),
    networks: ['bb-orders_default'],
    volumes: ['bb-orders_data'],
    readiness: {
      kind: 'available',
      value: { url: 'http://localhost:3000/health', status: 'ready', durationMs: 100 },
    },
  };
}

function runningActivity(activityId = 'activity-running'): CapsuleActivityReport {
  return {
    kind: 'running',
    activityId,
    sequence: 2,
    purpose: 'stimulus',
    target: { kind: 'host' },
    argv: ['curl', 'http://localhost:3000'],
    telemetry: activeTelemetry(activityId),
    startedAt: '2026-09-25T09:02:00.000Z',
  };
}

function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('dead Capsule manager reconciliation', () => {
  it('interrupts running activities before recording manager failure without claiming cleanup', async () => {
    let record = runningRecord('/project');
    let activities = [completedHostActivity(), runningActivity()];
    const writes: string[] = [];
    const ports = {
      now: () => completedAt,
      signal: () => { throw processError('ESRCH'); },
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
        cleanup: { kind: 'not-attempted' },
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

describe('Capsule manager process proof', () => {
  it.each([
    { label: 'live', signal: () => true as const, reason: 'manager-alive' },
    { label: 'permission denied', signal: () => { throw processError('EPERM'); }, reason: 'manager-alive' },
    {
      label: 'unknown probe failure',
      signal: () => { throw processError('EIO'); },
      reason: 'manager-liveness-unconfirmed',
    },
  ])('does not reconcile a $label manager probe', async ({ signal, reason }) => {
    const record = runningRecord('/project');
    const writeActivities = vi.fn<CapsuleManagerRecoveryPorts['writeActivities']>();
    const writeRecord = vi.fn<CapsuleManagerRecoveryPorts['writeRecord']>();
    const ports = {
      now: () => completedAt,
      signal,
      readRecord: () => Promise.resolve(record),
      readActivities: () => Promise.resolve([runningActivity()]),
      writeActivities,
      writeRecord,
    } satisfies CapsuleManagerRecoveryPorts;
    await expect(
      reconcileDeadCapsuleManagerWithPorts(
        { projectDirectory: '/project', sessionId: record.sessionId },
        ports,
      ),
    ).resolves.toMatchObject({ kind: 'capsule-manager-reconciliation-skipped', reason });
    expect(writeActivities).not.toHaveBeenCalled();
    expect(writeRecord).not.toHaveBeenCalled();
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
          readRecord: () => Promise.resolve(record),
          readActivities: () => Promise.resolve([runningActivity()]),
          writeActivities: () => Promise.resolve(),
          writeRecord: writes,
        },
      );
      expect(result.kind).toBe('capsule-manager-reconciliation-skipped');
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it('preserves failed cleanup when a stop-failed manager is dead', async () => {
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
        readRecord: () => Promise.resolve(record),
        readActivities: () => Promise.resolve([]),
        writeActivities: () => Promise.resolve(),
        writeRecord: (input) => {
          record = input.record;
          return Promise.resolve();
        },
      },
    );
    expect(result).toMatchObject({
      kind: 'capsule-manager-reconciled',
      record: {
        state: 'manager-failed',
        cleanup: {
          kind: 'failed',
          error: { name: 'DockerError', message: 'resource release failed' },
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
      .resolves.toMatchObject({ state: 'manager-failed', cleanup: { kind: 'not-attempted' } });
    await expect(
      reconcileDeadCapsuleManager({ projectDirectory, sessionId: record.sessionId }),
    ).resolves.toMatchObject({
      kind: 'capsule-manager-reconciliation-skipped',
      reason: 'terminal-session',
    });
  });
});
