import { readLock, removeLock } from '../io.js';
import { removeMarkerRecord } from '../marker-recovery.js';
import type { CurrentLockRecord } from '../record.js';
import { createLeaseRuntime } from '../process-instance.js';
import type { LeaseRuntime } from '../types.js';

/**
 * Removes the owned candidate (its path is unique to this token) and the
 * marker. The shared marker path is removed only through its guard, like any
 * other marker removal: if another claimer is recovering this marker, that
 * claimer removes it instead.
 */
export async function releaseOwnedLockWith(input: {
  readonly path: string;
  readonly markerPath: string;
  readonly record: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
}): Promise<void> {
  const lock = await readLock(input.path);
  if (
    lock.kind === 'lock-read' &&
    lock.decoded.kind === 'lock-record-decoded' &&
    lock.decoded.record.kind === 'collector-storage-lock-v2' &&
    lock.decoded.record.token === input.record.token
  ) {
    await removeLock(input.path);
  }
  await removeMarkerRecord({
    path: input.markerPath,
    token: input.record.token,
    claimer: input.record,
    runtime: input.runtime,
    depth: 0,
  });
}

/**
 * Releases the files held under `token`, identifying the guard holder as the
 * running process. Files that carry another token are left untouched.
 */
export async function releaseOwnedLock(input: {
  readonly path: string;
  readonly markerPath: string;
  readonly token: string;
}): Promise<void> {
  const runtime = await createLeaseRuntime();
  await releaseOwnedLockWith({
    path: input.path,
    markerPath: input.markerPath,
    record: {
      kind: 'collector-storage-lock-v2',
      owner: runtime.currentOwner,
      token: input.token,
      createdAt: runtime.now(),
    },
    runtime,
  });
}
