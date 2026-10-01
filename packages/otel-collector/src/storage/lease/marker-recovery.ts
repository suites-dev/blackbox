import { stat } from 'node:fs/promises';
import { encodedToken } from './candidate.js';
import { publishLock, readLock, removeLock } from './io.js';
import { inspectLockOwnership } from './ownership.js';
import type { CurrentLockRecord } from './record.js';
import type { LeaseRuntime } from './types.js';

/** A crashed guard holder is itself recovered through a guard, at most this deep. */
const MAX_GUARD_DEPTH = 2;

/**
 * The guard that serializes removal of one exact record at `path`: its name
 * carries that record's token, so only one holder at a time may remove it.
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

/**
 * Publishes the guard atomically: written and synced under a temporary name
 * first, then linked into place, so the guard path never holds a partial
 * record that later claimers would have to treat as foreign.
 */
async function createGuard(path: string, claimer: CurrentLockRecord): Promise<boolean> {
  const temporaryPath = `${path}.${encodedToken(claimer.token)}.tmp`;
  // The temporary name is unique to this claimer's token: a file there is a
  // leftover of this claimer's own interrupted publish, never contention.
  await removeLock(temporaryPath);
  try {
    await publishLock({ temporaryPath, path, record: claimer });
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
 * Guards are not heartbeated: one held by a process in another PID namespace
 * is stale once it is older than the staleness threshold.
 */
async function expired(path: string, runtime: LeaseRuntime): Promise<boolean> {
  try {
    const guard = await stat(path);
    return runtime.nowMilliseconds() - guard.mtimeMs > runtime.staleAfterMs;
  } catch {
    return false;
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
  const stale =
    ownership.kind === 'stale-lock' ||
    (ownership.kind === 'heartbeat-qualified-lock' &&
      (await expired(input.guardPath, input.runtime)));
  if (!stale) {
    return false;
  }
  return removeMarkerRecord({
    path: input.guardPath,
    token: guard.decoded.record.token,
    claimer: input.claimer,
    runtime: input.runtime,
    depth: input.depth + 1,
  });
}

/**
 * Removes the record at `path` only if it still carries `token`, as one
 * atomic claim: first create the guard for that token (only one holder at a
 * time can), then, while holding it, re-read `path` and unlink it only if it
 * still carries the token. Every removal of a marker record goes through
 * here, the owner's own release included, so no removal can delete a record
 * that replaced the one it inspected. Returns true when `path` no longer
 * holds that record (removed here or already gone), false when it now holds
 * another record or another holder is removing it.
 */
export async function removeMarkerRecord(input: {
  readonly path: string;
  readonly token: string;
  readonly claimer: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
  readonly depth: number;
}): Promise<boolean> {
  const guardPath = recoveryGuardPath({ path: input.path, token: input.token });
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
      current.decoded.record.token !== input.token
    ) {
      return false;
    }
    await removeLock(input.path);
    return true;
  } finally {
    await releaseGuard(guardPath, input.claimer);
  }
}
