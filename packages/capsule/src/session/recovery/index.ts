import { recoverSandbox } from '@suites/blackbox-sandbox-internal';

import type { CapsuleActivityReport, CapsuleRecordedError } from '../../types.js';
import {
  readCapsuleActivities,
  readCapsuleRecord,
  recordedError,
  writeCapsuleActivities,
  writeCapsuleRecord,
  type CapsuleSessionRecord,
} from '../../records.js';
import { cleanupAfterManagerDeath } from './sandbox-cleanup.js';

export interface ReconcileDeadCapsuleManagerInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
}

export type CapsuleManagerReconciliationResult =
  | {
      readonly kind: 'capsule-manager-reconciled';
      readonly record: CapsuleSessionRecord;
      readonly interruptedActivityIds: readonly string[];
    }
  | {
      readonly kind: 'capsule-manager-reconciliation-skipped';
      readonly record: CapsuleSessionRecord;
      readonly reason:
        | 'terminal-session'
        | 'manager-not-started'
        | 'manager-changed'
        | 'manager-alive'
        | 'manager-liveness-unconfirmed';
    };

export interface CapsuleManagerRecoveryPorts {
  readonly now: () => string;
  readonly signal: (pid: number, signal: 0) => true;
  readonly readRecord: typeof readCapsuleRecord;
  readonly readActivities: typeof readCapsuleActivities;
  readonly writeActivities: typeof writeCapsuleActivities;
  readonly writeRecord: typeof writeCapsuleRecord;
  readonly recoverSandbox: typeof recoverSandbox;
}

type ManagerProcessStatus =
  | { readonly kind: 'alive' }
  | { readonly kind: 'dead' }
  | { readonly kind: 'unconfirmed'; readonly error: CapsuleRecordedError };

const terminalStates = new Set<CapsuleSessionRecord['state']>([
  'stopped',
  'start-failed',
  'manager-failed',
]);

const productionPorts = {
  now: () => new Date().toISOString(),
  signal: (pid: number, signal: 0) => process.kill(pid, signal),
  readRecord: readCapsuleRecord,
  readActivities: readCapsuleActivities,
  writeActivities: writeCapsuleActivities,
  writeRecord: writeCapsuleRecord,
  recoverSandbox,
} satisfies CapsuleManagerRecoveryPorts;

function processStatus(pid: number, signal: CapsuleManagerRecoveryPorts['signal']): ManagerProcessStatus {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return {
      kind: 'unconfirmed',
      error: { name: 'InvalidCapsuleManagerPid', message: `Invalid Capsule manager PID: ${pid}` },
    };
  }
  try {
    signal(pid, 0);
    return { kind: 'alive' };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return { kind: 'dead' };
    }
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      return { kind: 'alive' };
    }
    return { kind: 'unconfirmed', error: recordedError(error) };
  }
}

function interruptActivity(input: {
  readonly activity: Extract<CapsuleActivityReport, { readonly kind: 'running' }>;
  readonly completedAt: string;
  readonly error: CapsuleRecordedError;
}): Extract<CapsuleActivityReport, { readonly kind: 'interrupted' }> {
  return {
    ...input.activity,
    kind: 'interrupted',
    telemetry: {
      ...input.activity.telemetry,
      kind: 'telemetry-execution-scope-completed-v1',
      endedAt: input.completedAt,
      result: { kind: 'telemetry-scope-interrupted', reason: input.error.message },
    },
    error: input.error,
    completedAt: input.completedAt,
  };
}

function reconcileActivities(input: {
  readonly activities: readonly CapsuleActivityReport[];
  readonly completedAt: string;
  readonly error: CapsuleRecordedError;
}): {
  readonly activities: readonly CapsuleActivityReport[];
  readonly interruptedActivityIds: readonly string[];
} {
  const interruptedActivityIds: string[] = [];
  const activities = input.activities.map((activity) => {
    if (activity.kind !== 'running') {
      return activity;
    }
    interruptedActivityIds.push(activity.activityId);
    return interruptActivity({ activity, completedAt: input.completedAt, error: input.error });
  });
  return { activities, interruptedActivityIds };
}

export async function reconcileDeadCapsuleManagerWithPorts(
  input: ReconcileDeadCapsuleManagerInput,
  ports: CapsuleManagerRecoveryPorts,
): Promise<CapsuleManagerReconciliationResult> {
  const record = await ports.readRecord(input);
  if (terminalStates.has(record.state)) {
    return { kind: 'capsule-manager-reconciliation-skipped', record, reason: 'terminal-session' };
  }
  if (record.manager.kind !== 'started') {
    return { kind: 'capsule-manager-reconciliation-skipped', record, reason: 'manager-not-started' };
  }
  const status = processStatus(record.manager.pid, ports.signal);
  if (status.kind !== 'dead') {
    return {
      kind: 'capsule-manager-reconciliation-skipped',
      record,
      reason: status.kind === 'alive' ? 'manager-alive' : 'manager-liveness-unconfirmed',
    };
  }

  const currentRecord = await ports.readRecord(input);
  if (terminalStates.has(currentRecord.state)) {
    return {
      kind: 'capsule-manager-reconciliation-skipped',
      record: currentRecord,
      reason: 'terminal-session',
    };
  }
  if (currentRecord.manager.kind !== 'started') {
    return {
      kind: 'capsule-manager-reconciliation-skipped',
      record: currentRecord,
      reason: 'manager-not-started',
    };
  }
  if (currentRecord.manager.pid !== record.manager.pid) {
    return {
      kind: 'capsule-manager-reconciliation-skipped',
      record: currentRecord,
      reason: 'manager-changed',
    };
  }

  const completedAt = ports.now();
  const error = {
    name: 'CapsuleManagerUnavailable',
    message: `Capsule manager process ${record.manager.pid} is unavailable`,
  } as const;
  const reconciled = reconcileActivities({
    activities: await ports.readActivities(input),
    completedAt,
    error,
  });
  const cleanup = await cleanupAfterManagerDeath({
    selector: input,
    record: currentRecord,
    recover: ports.recoverSandbox,
  });
  const failedRecord = {
    ...currentRecord,
    state: 'manager-failed',
    revision: currentRecord.revision + 1,
    updatedAt: completedAt,
    failure: { kind: 'recorded', error },
    cleanup,
  } satisfies CapsuleSessionRecord;
  await ports.writeActivities({ ...input, activities: reconciled.activities });
  await ports.writeRecord({ projectDirectory: input.projectDirectory, record: failedRecord });
  return {
    kind: 'capsule-manager-reconciled',
    record: failedRecord,
    interruptedActivityIds: reconciled.interruptedActivityIds,
  };
}

export async function reconcileDeadCapsuleManager(
  input: ReconcileDeadCapsuleManagerInput,
): Promise<CapsuleManagerReconciliationResult> {
  return reconcileDeadCapsuleManagerWithPorts(input, productionPorts);
}
