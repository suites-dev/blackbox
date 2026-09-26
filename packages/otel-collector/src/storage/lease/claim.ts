import { mkdir, rename } from 'node:fs/promises';
import { candidatePath, temporaryCandidatePath } from './candidate.js';
import { readCandidateSet } from './candidate-set.js';
import { publishLock, removeLock } from './io.js';
import { admitLegacyLock } from './legacy.js';
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

export async function claimLock(input: {
  readonly legacyPath: string;
  readonly directory: string;
  readonly record: CurrentLockRecord;
  readonly runtime: LeaseRuntime;
  readonly sessionId: string;
  readonly executionId: string;
}): Promise<string> {
  if (!(await admitLegacyLock({ path: input.legacyPath, runtime: input.runtime }))) {
    throw conflict(input);
  }
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
      return owned;
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
}
