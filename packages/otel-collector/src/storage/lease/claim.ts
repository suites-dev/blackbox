import { mkdir, rename } from 'node:fs/promises';
import { candidatePath, encodedToken, temporaryCandidatePath } from './candidate.js';
import { readCandidateSet } from './candidate-set.js';
import { publishLock, readLock, removeLock } from './io.js';
import { admitLeaseMarker } from './admission-marker.js';
import type { CurrentLockRecord } from './record.js';
import type { LeaseRuntime } from './types.js';

function conflict(input: { readonly sessionId: string; readonly executionId: string }): Error {
  return new Error(
    `A collector already owns session ${input.sessionId} execution ${input.executionId}.`,
  );
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 2));
}

async function removePublishedMarker(input: {
  readonly path: string;
  readonly token: string;
}): Promise<void> {
  const lock = await readLock(input.path);
  if (
    lock.kind === 'lock-read' &&
    lock.decoded.kind === 'lock-record-decoded' &&
    lock.decoded.record.kind === 'collector-storage-lock-v2' &&
    lock.decoded.record.token === input.token
  ) {
    await removeLock(input.path);
  }
}

async function admitOrConflict(input: {
  readonly markerPath: string;
  readonly record: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
  readonly sessionId: string;
  readonly executionId: string;
}): Promise<void> {
  const admitted = await admitLeaseMarker({
    path: input.markerPath,
    claimer: input.record,
    runtime: input.runtime,
  });
  if (!admitted) {
    throw conflict(input);
  }
}

export async function claimLock(input: {
  readonly markerPath: string;
  readonly directory: string;
  readonly record: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
  readonly sessionId: string;
  readonly executionId: string;
}): Promise<{ readonly ownedPath: string; readonly markerPath: string }> {
  await admitOrConflict(input);
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const claiming = candidatePath({
    directory: input.directory,
    token: input.record.token,
    state: 'claiming',
  });
  const owned = candidatePath({
    directory: input.directory,
    token: input.record.token,
    state: 'owned',
  });
  const markerTemporaryPath = `${input.markerPath}.${encodedToken(input.record.token)}.tmp`;
  try {
    await publishLock({
      temporaryPath: markerTemporaryPath,
      path: input.markerPath,
      record: input.record,
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw conflict(input);
    }
    throw error;
  }
  try {
    await publishLock({
      temporaryPath: temporaryCandidatePath({
        directory: input.directory,
        token: input.record.token,
      }),
      path: claiming,
      record: input.record,
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const set = await readCandidateSet({ directory: input.directory, runtime: input.runtime });
      if (set.kind === 'foreign-candidate') {
        await removeLock(claiming);
        throw conflict(input);
      }
      const others = set.candidates.filter(
        (candidate) => candidate.record.token !== input.record.token,
      );
      if (others.some((candidate) => candidate.kind === 'owned-candidate')) {
        await removeLock(claiming);
        throw conflict(input);
      }
      if (others.length === 0) {
        await rename(claiming, owned);
        return { ownedPath: owned, markerPath: input.markerPath };
      }
      const tokens = [input.record.token, ...others.map((candidate) => candidate.record.token)];
      if (tokens.sort()[0] !== input.record.token) {
        await removeLock(claiming);
        throw conflict(input);
      }
      await settle();
    }
    await removeLock(claiming);
    throw conflict(input);
  } catch (error) {
    await removePublishedMarker({ path: input.markerPath, token: input.record.token });
    throw error;
  }
}
