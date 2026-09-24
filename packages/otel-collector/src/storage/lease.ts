import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CollectorIdentity } from '../model/types.js';
import { fragmentDirectory, lockPath, sessionDirectory } from './paths.js';

interface LockRecord {
  readonly pid: number;
  readonly token: string;
  readonly createdAt: string;
}

export interface CollectorStorageLease extends CollectorIdentity {
  readonly storageDirectory: string;
  readonly token: string;
  readonly release: () => Promise<void>;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function removeStaleLock(path: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('pid' in parsed) ||
      typeof parsed.pid !== 'number'
    ) {
      return false;
    }
    if (processExists(parsed.pid)) {
      return false;
    }
    await unlink(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return true;
    }
    return false;
  }
}

async function claimLock(
  input: CollectorIdentity & { readonly storageDirectory: string; readonly token: string },
): Promise<void> {
  const path = lockPath(input);
  const record = {
    pid: process.pid,
    token: input.token,
    createdAt: new Date().toISOString(),
  } satisfies LockRecord;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await open(path, 'wx', 0o600);
      await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await file.sync();
      await file.close();
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      if (attempt === 0 && (await removeStaleLock(path))) {
        continue;
      }
      throw new Error(
        `A collector already owns session ${input.sessionId} execution ${input.executionId}.`,
      );
    }
  }
}

async function releaseOwnedLock(
  input: CollectorIdentity & { readonly storageDirectory: string; readonly token: string },
): Promise<void> {
  const path = lockPath(input);
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as LockRecord;
    if (record.token === input.token) {
      await unlink(path);
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

export async function acquireStorageLease(
  input: CollectorIdentity & { readonly storageDirectory: string },
): Promise<CollectorStorageLease> {
  await mkdir(sessionDirectory(input), { recursive: true, mode: 0o700 });
  await mkdir(fragmentDirectory(input), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  await claimLock({ ...input, token });
  return { ...input, token, release: () => releaseOwnedLock({ ...input, token }) };
}
