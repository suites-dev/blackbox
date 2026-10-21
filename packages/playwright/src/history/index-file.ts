import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalize, digestOf, type Digest } from '../envelope/canonical.js';
import type { HistoryIndex } from './index-build.js';
import { objectKinds, type ObjectKind, type ObjectStore } from './store.js';

/** The persisted index, only if it is intact. It is a cache: any doubt means "rebuild". */
export async function readIndexFile(root: string): Promise<HistoryIndex | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(root, 'index', 'index.json'), 'utf8'),
    ) as HistoryIndex;
    const { digest, ...rest } = parsed;
    return digest === digestOf(rest) ? parsed : null;
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
    receipt: index.receipts.map(({ id }) => id),
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
