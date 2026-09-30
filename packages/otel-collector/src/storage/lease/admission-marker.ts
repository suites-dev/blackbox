import { stat } from 'node:fs/promises';
import { readLock, removeLock } from './io.js';
import { inspectLockOwnership } from './ownership.js';
import type { LeaseRuntime } from './types.js';

export async function admitLeaseMarker(input: {
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
  if (ownership.kind === 'heartbeat-qualified-lock') {
    try {
      const heartbeat = await stat(input.path);
      if (input.runtime.nowMilliseconds() - heartbeat.mtimeMs <= input.runtime.staleAfterMs) {
        return false;
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return true;
      }
      return false;
    }
  }
  if (ownership.kind === 'active-lock') {
    return false;
  }
  await removeLock(input.path);
  return true;
}
