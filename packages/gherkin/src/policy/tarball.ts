import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { isObject } from '../project/reader.js';

// Reads the package.json that `npm pack` or `pnpm pack` writes into a package
// tarball (a gzipped ustar archive whose files sit under `package/`), so a
// local tarball install can be checked for the package and version it holds.

const BLOCK = 512;

/** A NUL-terminated tar header field. */
function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/** One file's bytes from an uncompressed tar archive, or null when the archive does not hold it. */
function tarEntry(archive: Buffer, path: string): Buffer | null {
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    const name = field(header, 0, 100);
    if (name === '') {
      return null;
    }
    const prefix = field(header, 345, 155);
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!Number.isSafeInteger(size)) {
      return null;
    }
    const start = offset + BLOCK;
    if ((prefix === '' ? name : `${prefix}/${name}`) === path) {
      return archive.subarray(start, start + size);
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return null;
}

export interface PackedPackage {
  readonly name: string;
  readonly version: string;
}

/** The name and version packed into `tarball`, or null when it is not a readable package tarball. */
export async function packedPackage(tarball: string): Promise<PackedPackage | null> {
  let archive: Buffer;
  try {
    archive = gunzipSync(await readFile(tarball));
  } catch {
    return null;
  }
  const entry = tarEntry(archive, 'package/package.json');
  if (entry === null) {
    return null;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(entry.toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(manifest) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    return null;
  }
  return { name: manifest.name, version: manifest.version };
}
