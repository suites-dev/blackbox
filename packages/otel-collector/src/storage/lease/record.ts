import type { ProcessOwner } from './types.js';

export interface CurrentLockRecord {
  readonly kind: 'collector-storage-lock-v2';
  readonly owner: ProcessOwner;
  readonly token: string;
  readonly createdAt: string;
}

export interface LegacyLockRecord {
  readonly kind: 'legacy-pid-lock';
  readonly pid: number;
  readonly token: string;
  readonly createdAt: string;
}

export type LockRecord = CurrentLockRecord | LegacyLockRecord;
export type LockDecodeResult =
  | { readonly kind: 'lock-record-decoded'; readonly record: LockRecord }
  | { readonly kind: 'foreign-lock' };

function validPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

interface CommonLockFields {
  readonly token: string;
  readonly createdAt: string;
}

function commonFields(value: object): value is object & CommonLockFields {
  return (
    'token' in value &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    'createdAt' in value &&
    typeof value.createdAt === 'string'
  );
}

function decodeOwner(value: unknown): ProcessOwner | null {
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('pid' in value)) {
    return null;
  }
  if (!validPid(value.pid)) {
    return null;
  }
  if (value.kind === 'pid-only-process') {
    return { kind: value.kind, pid: value.pid };
  }
  if (
    value.kind !== 'linux-process-instance' ||
    !('pidNamespace' in value) ||
    typeof value.pidNamespace !== 'string' ||
    value.pidNamespace.length === 0 ||
    !('bootId' in value) ||
    typeof value.bootId !== 'string' ||
    !('startTimeTicks' in value) ||
    typeof value.startTimeTicks !== 'string' ||
    !/^\d+$/u.test(value.startTimeTicks)
  ) {
    return null;
  }
  return {
    kind: value.kind,
    pid: value.pid,
    pidNamespace: value.pidNamespace,
    bootId: value.bootId,
    startTimeTicks: value.startTimeTicks,
  };
}

export function decodeLockRecord(value: unknown): LockDecodeResult {
  if (typeof value !== 'object' || value === null || !commonFields(value)) {
    return { kind: 'foreign-lock' };
  }
  if ('kind' in value && value.kind === 'collector-storage-lock-v2' && 'owner' in value) {
    const owner = decodeOwner(value.owner);
    return owner === null
      ? { kind: 'foreign-lock' }
      : {
          kind: 'lock-record-decoded',
          record: {
            kind: value.kind,
            owner,
            token: value.token,
            createdAt: value.createdAt,
          },
        };
  }
  if (!('kind' in value) && 'pid' in value && validPid(value.pid)) {
    return {
      kind: 'lock-record-decoded',
      record: {
        kind: 'legacy-pid-lock',
        pid: value.pid,
        token: value.token,
        createdAt: value.createdAt,
      },
    };
  }
  return { kind: 'foreign-lock' };
}
