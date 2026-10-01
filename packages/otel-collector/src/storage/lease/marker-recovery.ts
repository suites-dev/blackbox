import { open } from 'node:fs/promises';
import { encodedToken } from './candidate.js';
import { readLock, removeLock } from './io.js';
import { inspectLockOwnership } from './ownership.js';
import type { CurrentLockRecord, LockRecord } from './record.js';
import type { LeaseRuntime } from './types.js';

/** A crashed guard holder is itself recovered through a guard, at most this deep. */
const MAX_GUARD_DEPTH = 2;

/**
 * The guard that serializes removal of one exact record at `path`: its name
 * carries that record's token, so it can be created exactly once per record.
 */
export function recoveryGuardPath(input: {
  readonly path: string;
  readonly token: string;
}): string {
  return `${input.path}.recover-${encodedToken(input.token)}`;
}

function isExisting(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function createGuard(path: string, claimer: CurrentLockRecord): Promise<boolean> {
  try {
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(claimer)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    return true;
  } catch (error) {
    if (isExisting(error)) {
      return false;
    }
    throw error;
  }
}

async function releaseGuard(path: string, claimer: CurrentLockRecord): Promise<void> {
  const guard = await readLock(path);
  if (
    guard.kind === 'lock-read' &&
    guard.decoded.kind === 'lock-record-decoded' &&
    guard.decoded.record.token === claimer.token
  ) {
    await removeLock(path);
  }
}

/**
 * Whether a guard found in place belongs to a holder that is gone, and was
 * then cleared, so the caller may try to create it again. Fail-closed: an
 * unreadable, foreign or live guard is never cleared.
 */
async function clearStaleGuard(input: {
  readonly guardPath: string;
  readonly claimer: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
  readonly depth: number;
}): Promise<boolean> {
  const guard = await readLock(input.guardPath);
  if (guard.kind === 'lock-missing') {
    return true;
  }
  if (guard.decoded.kind === 'foreign-lock' || input.depth >= MAX_GUARD_DEPTH) {
    return false;
  }
  const ownership = await inspectLockOwnership({
    record: guard.decoded.record,
    runtime: input.runtime,
  });
  if (ownership.kind !== 'stale-lock') {
    return false;
  }
  return removeStaleRecord({
    path: input.guardPath,
    stale: guard.decoded.record,
    claimer: input.claimer,
    runtime: input.runtime,
    depth: input.depth + 1,
  });
}

/**
 * Removes the record at `path` only if it is still exactly `stale`, as one
 * atomic claim: first create the guard for that record with O_CREAT|O_EXCL
 * (only one claimer can), then, while holding it, re-read `path` and unlink
 * it only if it still carries the stale token. Returns true when `path` no
 * longer holds the stale record (removed here or already gone), false when it
 * now holds another record or another claimer is recovering it.
 */
export async function removeStaleRecord(input: {
  readonly path: string;
  readonly stale: LockRecord;
  readonly claimer: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
  readonly depth: number;
}): Promise<boolean> {
  const guardPath = recoveryGuardPath({ path: input.path, token: input.stale.token });
  if (!(await createGuard(guardPath, input.claimer))) {
    if (!(await clearStaleGuard({ ...input, guardPath }))) {
      return false;
    }
    if (!(await createGuard(guardPath, input.claimer))) {
      return false;
    }
  }
  try {
    const current = await readLock(input.path);
    if (current.kind === 'lock-missing') {
      return true;
    }
    if (
      current.decoded.kind !== 'lock-record-decoded' ||
      current.decoded.record.token !== input.stale.token
    ) {
      return false;
    }
    await removeLock(input.path);
    return true;
  } finally {
    await releaseGuard(guardPath, input.claimer);
  }
}
