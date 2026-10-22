import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Digest } from '../../envelope/index.js';

export const objectKinds = ['envelope', 'blob', 'receipt', 'alias', 'delta'] as const;
export type ObjectKind = (typeof objectKinds)[number];

const identity = /^sha256:([0-9a-f]{64})$/u;

/** The largest single record the store accepts. A record is read whole, so an unbounded one is a memory attack. */
export const maxObjectBytes = 256 * 1024 * 1024;

// The history can hold excerpts of what the system under test did; only its owner needs to read it.
const privateDirectory = 0o700;

/** A different record already exists under the same identity: the store is corrupt or a digest collided. */
export class ConflictError extends Error {
  constructor(
    readonly kind: ObjectKind,
    readonly id: Digest,
  ) {
    super(`A different ${kind} already exists under ${id}`);
  }
}

function hexOf(id: Digest): string {
  const match = identity.exec(id);
  if (match === null) {
    throw new TypeError(`Not a content identity: ${id}`);
  }
  return match[1];
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Content-addressed, write-once object files. There is no update and no delete. A record is written to a private
 * temporary file, flushed, and hard-linked into place: the link fails if the identity exists, so two writers
 * racing on the same record both succeed and nobody overwrites anybody.
 */
export class ObjectStore {
  constructor(
    readonly root: string,
    private readonly limit: number = maxObjectBytes,
  ) {}

  path(kind: ObjectKind, id: Digest): string {
    if (!objectKinds.includes(kind)) {
      throw new TypeError(`Not an object kind: ${JSON.stringify(kind)}`);
    }
    const hex = hexOf(id);
    return join(this.root, 'objects', kind, hex.slice(0, 2), hex);
  }

  async put(
    kind: ObjectKind,
    id: Digest,
    bytes: string | Uint8Array,
  ): Promise<{ readonly created: boolean }> {
    const data = Buffer.from(bytes);
    if (data.byteLength > this.limit) {
      throw new RangeError(
        `A ${kind} of ${String(data.byteLength)} bytes exceeds ${String(this.limit)}`,
      );
    }
    const target = this.path(kind, id);
    const same = async (): Promise<{ readonly created: false }> => {
      const existing = await readIfPresent(target);
      if (existing === null || !existing.equals(data)) {
        throw new ConflictError(kind, id);
      }
      return { created: false };
    };
    if ((await readIfPresent(target)) !== null) {
      return same();
    }
    await mkdir(dirname(target), { recursive: true, mode: privateDirectory });
    await mkdir(join(this.root, 'tmp'), { recursive: true, mode: privateDirectory });
    const partial = join(this.root, 'tmp', `${kind}-${randomUUID()}.partial`);
    const handle = await open(partial, 'wx', 0o444);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(partial, target);
      return { created: true };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        return await same();
      }
      throw error;
    } finally {
      await unlink(partial).catch(() => undefined);
    }
  }

  get(kind: ObjectKind, id: Digest): Promise<Buffer | null> {
    return readIfPresent(this.path(kind, id));
  }

  async list(kind: ObjectKind): Promise<Digest[]> {
    const base = join(this.root, 'objects', kind);
    const found: Digest[] = [];
    for (const shard of await readdir(base).catch(() => [])) {
      for (const name of await readdir(join(base, shard)).catch(() => [])) {
        if (/^[0-9a-f]{64}$/u.test(name) && name.startsWith(shard)) {
          found.push(`sha256:${name}`);
        }
      }
    }
    return found.sort();
  }

  /** Files left by writes that were interrupted before they were linked into place. They are never visible as objects. */
  async interrupted(): Promise<string[]> {
    return (await readdir(join(this.root, 'tmp')).catch(() => []))
      .filter((name) => name.endsWith('.partial'))
      .sort();
  }

  /** Removes interrupted-write files older than the given age. Complete objects are never touched. */
  async clearInterrupted(olderThanMs: number, now: number = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    for (const name of await this.interrupted()) {
      const path = join(this.root, 'tmp', name);
      const info = await stat(path).catch(() => null);
      if (info !== null && now - info.mtimeMs >= olderThanMs) {
        await unlink(path).catch(() => undefined);
        removed.push(name);
      }
    }
    return removed;
  }
}
