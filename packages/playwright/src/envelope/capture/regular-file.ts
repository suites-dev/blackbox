import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * The bytes of a regular file no larger than `limit`, or `null` when there is none, it is not a regular file, or
 * it is too large. It is opened without waiting on a pipe and checked through the descriptor it is read from, so
 * what is read is what was checked even if the path is replaced in between.
 */
export async function regularFileBytes(path: string, limit: number): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) {
      return null;
    }
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
