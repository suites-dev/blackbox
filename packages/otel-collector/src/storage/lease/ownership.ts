import type { LockRecord } from './record.js';
import type { LeaseRuntime, LinuxProcessOwner } from './types.js';

export type LockOwnership =
  | { readonly kind: 'active-lock' }
  | { readonly kind: 'heartbeat-qualified-lock' }
  | { readonly kind: 'stale-lock' };

function sameLinuxProcess(left: LinuxProcessOwner, right: LinuxProcessOwner): boolean {
  return (
    left.pid === right.pid &&
    left.pidNamespace === right.pidNamespace &&
    left.bootId === right.bootId &&
    left.startTimeTicks === right.startTimeTicks
  );
}

export async function inspectLockOwnership(input: {
  readonly record: LockRecord;
  readonly runtime: LeaseRuntime;
}): Promise<LockOwnership> {
  if (
    input.record.kind === 'collector-storage-lock-v2' &&
    input.record.owner.kind === 'linux-process-instance' &&
    input.runtime.currentOwner.kind === 'linux-process-instance' &&
    input.record.owner.pidNamespace !== input.runtime.currentOwner.pidNamespace
  ) {
    return { kind: 'heartbeat-qualified-lock' };
  }
  const pid = input.record.kind === 'legacy-pid-lock' ? input.record.pid : input.record.owner.pid;
  const inspection = await input.runtime.inspectProcess({ pid });
  if (inspection.kind === 'process-missing') {
    return { kind: 'stale-lock' };
  }
  if (
    inspection.kind === 'process-alive-unidentified' ||
    inspection.kind === 'process-inspection-unavailable' ||
    input.record.kind === 'legacy-pid-lock' ||
    input.record.owner.kind === 'pid-only-process'
  ) {
    return { kind: 'active-lock' };
  }
  return sameLinuxProcess(input.record.owner, inspection.owner)
    ? { kind: 'active-lock' }
    : { kind: 'stale-lock' };
}
