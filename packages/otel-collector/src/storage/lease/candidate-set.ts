import { readdir, stat } from 'node:fs/promises';
import { decodeCandidateName, encodedToken, type LockCandidate } from './candidate.js';
import { readLock, removeLock } from './io.js';
import { inspectLockOwnership } from './ownership.js';
import type { LeaseRuntime } from './types.js';

export type CandidateSetRead =
  | { readonly kind: 'candidate-set'; readonly candidates: readonly LockCandidate[] }
  | { readonly kind: 'foreign-candidate' };

async function readCandidate(input: {
  readonly directory: string;
  readonly name: string;
  readonly runtime: LeaseRuntime;
}): Promise<LockCandidate | 'foreign' | 'stale'> {
  const decodedName = decodeCandidateName(input);
  if (decodedName.kind === 'foreign-name') {
    return 'foreign';
  }
  const lock = await readLock(decodedName.path);
  if (lock.kind === 'lock-missing') {
    return 'stale';
  }
  const decoded = lock.decoded;
  if (
    decoded.kind === 'foreign-lock' ||
    decoded.record.kind !== 'collector-storage-lock-v2' ||
    decodedName.encodedToken !== encodedToken(decoded.record.token)
  ) {
    return 'foreign';
  }
  const ownership = await inspectLockOwnership({ record: decoded.record, runtime: input.runtime });
  if (ownership.kind === 'stale-lock') {
    await removeLock(decodedName.path);
    return 'stale';
  }
  if (ownership.kind === 'heartbeat-qualified-lock') {
    try {
      const heartbeat = await stat(decodedName.path);
      if (input.runtime.nowMilliseconds() - heartbeat.mtimeMs > input.runtime.staleAfterMs) {
        await removeLock(decodedName.path);
        return 'stale';
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return 'stale';
      }
      return 'foreign';
    }
  }
  return {
    kind: decodedName.state === 'owned' ? 'owned-candidate' : 'claiming-candidate',
    path: decodedName.path,
    record: decoded.record,
  };
}

export async function readCandidateSet(input: {
  readonly directory: string;
  readonly runtime: LeaseRuntime;
}): Promise<CandidateSetRead> {
  const candidates: LockCandidate[] = [];
  for (const name of await readdir(input.directory)) {
    const candidate = await readCandidate({ ...input, name });
    if (candidate === 'foreign') {
      return { kind: 'foreign-candidate' };
    }
    if (candidate !== 'stale') {
      candidates.push(candidate);
    }
  }
  return { kind: 'candidate-set', candidates };
}
