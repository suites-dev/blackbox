import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const TRANSIENT_WINDOWS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const MAXIMUM_ATTEMPTS = 40;

/**
 * Atomically replaces `target` with `source`. Windows refuses to rename over a
 * file that another process (a concurrent reader, an indexer, antivirus) holds
 * open, so transient refusals there are retried for a few seconds. Every other
 * platform and error code fails on the first attempt.
 */
export async function replaceFile(
  source: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
  renameFile: (source: string, target: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await renameFile(source, target);
      return;
    } catch (error) {
      if (platform !== 'win32' || attempt >= MAXIMUM_ATTEMPTS || !isTransient(error)) {
        throw error;
      }
      await delay(Math.min(10 * attempt, 100));
    }
  }
}

function isTransient(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    TRANSIENT_WINDOWS_CODES.has(error.code)
  );
}
