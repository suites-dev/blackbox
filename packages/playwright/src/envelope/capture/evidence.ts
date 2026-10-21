import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { digestBytes, digestOf, type Digest } from '../canonical.js';
import type { EvidenceRef } from '../types.js';

async function entries(
  directory: string,
): Promise<{ name: string; path: string; directory: boolean }[]> {
  try {
    return (await readdir(directory, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      path: join(directory, entry.name),
      directory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

async function fileRef(
  root: string,
  path: string,
  kind: EvidenceRef['kind'],
): Promise<EvidenceRef | null> {
  try {
    const bytes = await readFile(path);
    return {
      id: digestBytes(bytes),
      kind,
      bytes: bytes.byteLength,
      locator: { type: 'file', root: 'test-output', path: relative(root, path) },
    };
  } catch {
    return null;
  }
}

/** The digest a fragments directory has now, computed the way the reference was when it was captured. */
export async function fragmentsDigest(directory: string): Promise<Digest | null> {
  const files = (await entries(directory))
    .filter((entry) => !entry.directory)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  if (files.length === 0) {
    return null;
  }
  return digestOf(
    await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        digest: digestBytes(await readFile(file.path)),
      })),
    ),
  );
}

/** Recomputes the digest of the file evidence a reference points to; `null` when it is gone. */
export async function currentEvidenceDigest(
  root: string,
  ref: EvidenceRef,
): Promise<Digest | null> {
  if (ref.locator.type !== 'file') {
    return null;
  }
  const path = join(root, ref.locator.path);
  if (ref.kind === 'collector-fragments') {
    return fragmentsDigest(path);
  }
  try {
    return digestBytes(await readFile(path));
  } catch {
    return null;
  }
}

async function fragmentsRef(root: string, directory: string): Promise<EvidenceRef | null> {
  const files = (await entries(directory))
    .filter((entry) => !entry.directory)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  if (files.length === 0) {
    return null;
  }
  const parts = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      digest: digestBytes(await readFile(file.path)),
      bytes: (await stat(file.path)).size,
    })),
  );
  return {
    id: digestOf(parts.map(({ name, digest }) => ({ name, digest }))),
    kind: 'collector-fragments',
    bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    locator: { type: 'file', root: 'test-output', path: relative(root, directory) },
  };
}

async function collectorRefs(
  root: string,
  directory: string,
  depth: number,
): Promise<EvidenceRef[]> {
  if (depth < 0) {
    return [];
  }
  const found: EvidenceRef[] = [];
  for (const entry of await entries(directory)) {
    if (entry.directory && entry.name === 'fragments') {
      const ref = await fragmentsRef(root, entry.path);
      if (ref !== null) {
        found.push(ref);
      }
    } else if (entry.directory) {
      found.push(...(await collectorRefs(root, entry.path, depth - 1)));
    } else if (entry.name === 'collector-lifecycle.json') {
      const ref = await fileRef(root, entry.path, 'collector-lifecycle');
      if (ref !== null) {
        found.push(ref);
      }
    }
  }
  return found;
}

/** The files this attempt left behind that its conclusions rest on, each reduced to a content digest. */
export async function retainedEvidence(input: {
  /** The test's output directory; locators are relative to it. */
  readonly root: string;
  readonly sandboxRecord: string;
  readonly collectorDirectory: string;
}): Promise<EvidenceRef[]> {
  const record = await fileRef(input.root, input.sandboxRecord, 'sandbox-record');
  return [
    ...(record === null ? [] : [record]),
    ...(await collectorRefs(input.root, input.collectorDirectory, 4)),
  ];
}
