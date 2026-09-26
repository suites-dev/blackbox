import { readLock, removeLock } from './io.js';
import { inspectLockOwnership } from './ownership.js';
import type { LeaseRuntime } from './types.js';

export async function admitLegacyLock(input: {
  readonly path: string;
  readonly runtime: LeaseRuntime;
}): Promise<boolean> {
  const lock = await readLock(input.path);
  if (lock.kind === 'lock-missing') {
    return true;
  }
  if (lock.decoded.kind === 'foreign-lock') {
    return false;
  }
  const ownership = await inspectLockOwnership({
    record: lock.decoded.record,
    runtime: input.runtime,
  });
  if (ownership.kind === 'active-lock') {
    return false;
  }
  await removeLock(input.path);
  return true;
}
