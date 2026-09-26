import { readLock, removeLock } from '../io.js';

export async function releaseOwnedLock(input: {
  readonly path: string;
  readonly token: string;
}): Promise<void> {
  const lock = await readLock(input.path);
  if (lock.kind === 'lock-missing' || lock.decoded.kind === 'foreign-lock') {
    return;
  }
  const record = lock.decoded.record;
  if (record.kind !== 'collector-storage-lock-v2' || record.token !== input.token) {
    return;
  }
  await removeLock(input.path);
}
