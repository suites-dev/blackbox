import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { regularFileBytes } from '../../envelope/capture/regular-file.js';
import { canonicalize, digestOf, type Digest } from '../../envelope/index.js';
import { indexVersion, type HistoryIndex } from './index-build.js';
import { maxObjectBytes, objectKinds, type ObjectKind, type ObjectStore } from './store.js';

/** The persisted index, only if it is intact. It is a cache: any doubt means "rebuild". */
export async function readIndexFile(root: string): Promise<HistoryIndex | null> {
  try {
    // A pipe, a link target that is not a file, or an oversized cache is not an index: rebuild instead of waiting.
    const bytes = await regularFileBytes(join(root, 'index', 'index.json'), maxObjectBytes);
    if (bytes === null) {
      return null;
    }
    const parsed = JSON.parse(bytes.toString('utf8')) as Omit<HistoryIndex, 'indexVersion'> & { indexVersion: number };
    const { digest, ...rest } = parsed;
    return parsed.indexVersion === indexVersion && digest === digestOf(rest) ? parsed as HistoryIndex : null;
  } catch {
    return null;
  }
}

/** Written to a private file and renamed, so a reader never sees half an index. Concurrent writers are harmless. */
export async function writeIndexFile(root: string, index: HistoryIndex): Promise<void> {
  await mkdir(join(root, 'index'), { recursive: true, mode: 0o700 });
  const partial = join(root, 'index', `index.${randomUUID()}.partial`);
  await writeFile(partial, canonicalize(index));
  await rename(partial, join(root, 'index', 'index.json'));
}

function known(index: HistoryIndex): Record<ObjectKind, readonly Digest[]> {
  return {
    envelope: index.executions.map(({ envelopeId }) => envelopeId),
    receipt: [...index.receipts.map(({ id }) => id), ...index.nativeResults.map(({ digest }) => digest)],
    alias: index.aliases.map(({ digest }) => digest),
    delta: index.deltas.map(({ id }) => id),
    blob: index.blobs,
  };
}

/** Whether every object in the store is accounted for by the index, as a record or as a reported corruption. */
export async function indexMatchesStore(store: ObjectStore, index: HistoryIndex): Promise<boolean> {
  const accountedFor = known(index);
  for (const kind of objectKinds) {
    const stored = await store.list(kind);
    const accounted = new Set([
      ...accountedFor[kind],
      ...index.corrupt.filter((item) => item.kind === kind).map(({ id }) => id),
    ]);
    if (stored.length !== accounted.size || stored.some((id) => !accounted.has(id))) {
      return false;
    }
  }
  return true;
}
