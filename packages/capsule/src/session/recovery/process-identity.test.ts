import { describe, expect, it, vi } from 'vitest';

import { decodeCapsuleSessionRecord } from '../../persistence/decoder.js';
import type { CapsuleSessionRecord } from '../../records.js';
import {
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

describe('Capsule manager process proof', () => {
  it.each([
    {
      label: 'live', signal: () => true as const,
      probe: { kind: 'manager-instance-exact' as const }, reason: 'manager-alive',
    },
    {
      label: 'permission denied', signal: () => { throw processError('EPERM'); },
      probe: { kind: 'manager-instance-exact' as const }, reason: 'manager-alive',
    },
    {
      label: 'unknown probe failure',
      signal: () => { throw processError('EIO'); },
      probe: { kind: 'manager-instance-unavailable' as const },
      reason: 'manager-liveness-unconfirmed',
    },
  ])('does not reconcile a $label manager probe', async ({ signal, probe, reason }) => {
    const record = runningRecord('/project');
    const writeActivities = vi.fn<CapsuleManagerRecoveryPorts['writeActivities']>();
    const writeRecord = vi.fn<CapsuleManagerRecoveryPorts['writeRecord']>();
    const ports = {
      now: () => completedAt,
      signal,
      probeManager: () => Promise.resolve(probe),
      readRecord: () => Promise.resolve(record),
      readActivities: () => Promise.resolve([runningActivity()]),
      writeActivities,
      writeRecord,
      recoverSandbox: noSandboxRecord,
    } satisfies CapsuleManagerRecoveryPorts;
    await expect(reconcileDeadCapsuleManagerWithPorts(
      { projectDirectory: '/project', sessionId: record.sessionId },
      ports,
    )).resolves.toMatchObject({ kind: 'capsule-manager-reconciliation-skipped', reason });
    expect(writeActivities).not.toHaveBeenCalled();
    expect(writeRecord).not.toHaveBeenCalled();
  });

  it('does not let a socket result override an unconfirmed process probe', async () => {
    const record = runningRecord('/project');
    const probeManager = vi.fn<CapsuleManagerRecoveryPorts['probeManager']>(() =>
      Promise.resolve({ kind: 'manager-socket-missing' }),
    );
    const recoverSandbox = vi.fn<CapsuleManagerRecoveryPorts['recoverSandbox']>();
    await expect(reconcileDeadCapsuleManagerWithPorts(
      { projectDirectory: '/project', sessionId: record.sessionId },
      {
        now: () => completedAt,
        signal: () => { throw processError('EIO'); },
        probeManager,
        readRecord: () => Promise.resolve(record),
        readActivities: () => Promise.resolve([]),
        writeActivities: () => Promise.resolve(),
        writeRecord: () => Promise.resolve(),
        recoverSandbox,
      },
    )).resolves.toMatchObject({
      kind: 'capsule-manager-reconciliation-skipped',
      reason: 'manager-liveness-unconfirmed',
    });
    expect(probeManager).not.toHaveBeenCalled();
    expect(recoverSandbox).not.toHaveBeenCalled();
  });
});

describe('Capsule manager identity proof', () => {
  it.each(['manager-instance-different', 'manager-socket-missing'] as const)(
    'reconciles a reused live PID when the socket probe reports %s',
    async (kind) => {
      let record = runningRecord('/project');
      const probeManager = vi.fn(() => Promise.resolve({ kind }));
      const result = await reconcileDeadCapsuleManagerWithPorts(
        { projectDirectory: '/project', sessionId: record.sessionId },
        {
          now: () => completedAt,
          signal: () => true,
          probeManager,
          readRecord: () => Promise.resolve(record),
          readActivities: () => Promise.resolve([]),
          writeActivities: () => Promise.resolve(),
          writeRecord: (input) => {
            record = input.record;
            return Promise.resolve();
          },
          recoverSandbox: noSandboxRecord,
        },
      );
      expect(result).toMatchObject({
        kind: 'capsule-manager-reconciled',
        record: { state: 'manager-failed' },
      });
      expect(probeManager).toHaveBeenCalledWith({
        socketPath: '/project/manager.sock',
        instanceId: 'manager-instance-a',
      });
    },
  );

  it('keeps a live legacy PID-only record fail-closed without a socket probe', async () => {
    const current = runningRecord('/project');
    const record = {
      ...current,
      manager: {
        kind: 'started',
        pid: current.manager.kind === 'started' ? current.manager.pid : 1,
        identity: { kind: 'legacy-pid-only' },
      },
    } satisfies CapsuleSessionRecord;
    const probeManager = vi.fn<CapsuleManagerRecoveryPorts['probeManager']>();
    await expect(reconcileDeadCapsuleManagerWithPorts(
      { projectDirectory: '/project', sessionId: record.sessionId },
      {
        now: () => completedAt,
        signal: () => true,
        probeManager,
        readRecord: () => Promise.resolve(record),
        readActivities: () => Promise.resolve([]),
        writeActivities: () => Promise.resolve(),
        writeRecord: () => Promise.resolve(),
        recoverSandbox: noSandboxRecord,
      },
    )).resolves.toMatchObject({
      kind: 'capsule-manager-reconciliation-skipped',
      reason: 'manager-alive',
    });
    expect(probeManager).not.toHaveBeenCalled();
  });

  it('normalizes a v1 PID-only artifact to explicit legacy identity', () => {
    const current = runningRecord('/project');
    const legacy = { ...current, manager: { kind: 'started', pid: 42_424 } };
    expect(decodeCapsuleSessionRecord({ bytes: JSON.stringify(legacy) }).manager).toEqual({
      kind: 'started',
      pid: 42_424,
      identity: { kind: 'legacy-pid-only' },
    });
  });
});
