import { link, open, readFile, unlink } from 'node:fs/promises';
import { decodeLockRecord, type CurrentLockRecord, type LockDecodeResult } from './record.js';

export type LockReadResult =
  | { readonly kind: 'lock-missing' }
  | { readonly kind: 'lock-read'; readonly decoded: LockDecodeResult };

export async function readLock(path: string): Promise<LockReadResult> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return { kind: 'lock-read', decoded: decodeLockRecord(value) };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { kind: 'lock-missing' };
    }
    return { kind: 'lock-read', decoded: { kind: 'foreign-lock' } };
  }
}

export async function publishLock(input: {
  readonly temporaryPath: string;
  readonly path: string;
  readonly record: CurrentLockRecord;
}): Promise<void> {
  const file = await open(input.temporaryPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(input.record)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(input.temporaryPath, input.path);
  } finally {
    await removeLock(input.temporaryPath);
  }
}

export async function removeLock(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}
