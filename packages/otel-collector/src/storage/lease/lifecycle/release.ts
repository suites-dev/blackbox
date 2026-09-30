import { readLock, removeLock } from '../io.js';

export async function releaseOwnedLock(input: {
  readonly path: string;
  readonly legacyPath: string;
  readonly token: string;
}): Promise<void> {
  for (const path of [input.path, input.legacyPath]) {
    const lock = await readLock(path);
    if (lock.kind === 'lock-missing' || lock.decoded.kind === 'foreign-lock') {
      continue;
    }
    const record = lock.decoded.record;
    if (record.kind !== 'collector-storage-lock-v2' || record.token !== input.token) {
      continue;
    }
    await removeLock(path);
  }
}
