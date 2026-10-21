import { digestBytes, digestOf, type Digest } from '../../envelope/canonical.js';
import { verifyEnvelope } from '../../envelope/verify.js';
import { verifyAlias, type BehaviorAlias } from '../aliases/alias.js';
import type { BehavioralDelta } from '../../compare/types.js';
import {
  deltaOf,
  executionOf,
  receiptOf,
  type AnyEnvelope,
  type CorruptObject,
  type IndexedDelta,
  type IndexedExecution,
  type IndexedReceipt,
} from './index-rows.js';
import { verifyReceipt, type AttemptReceipt } from '../receipts/receipt.js';
import { verifyDelta } from './records.js';
import type { ObjectKind, ObjectStore } from './store.js';

export type { CorruptObject, IndexedDelta, IndexedExecution, IndexedReceipt };

export const indexVersion = 1;

export interface HistoryIndex {
  readonly indexVersion: typeof indexVersion;
  readonly executions: readonly IndexedExecution[];
  readonly receipts: readonly IndexedReceipt[];
  readonly aliases: readonly BehaviorAlias[];
  readonly deltas: readonly IndexedDelta[];
  readonly blobs: readonly Digest[];
  readonly corrupt: readonly CorruptObject[];
  /** A digest of everything above. Equal stores give equal digests, so a rebuild can be checked. */
  readonly digest: Digest;
}

async function readJson(store: ObjectStore, kind: ObjectKind, id: Digest): Promise<unknown> {
  const bytes = await store.get(kind, id);
  if (bytes === null) {
    throw new Error('object disappeared while indexing');
  }
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

type Reject = (kind: ObjectKind, id: Digest, reason: string) => void;

async function loadEnvelopes(store: ObjectStore, bad: Reject): Promise<AnyEnvelope[]> {
  const found: AnyEnvelope[] = [];
  for (const id of await store.list('envelope')) {
    try {
      const value = await readJson(store, 'envelope', id);
      const result = verifyEnvelope(value);
      if (result.ok && (value as AnyEnvelope).digest === id) {
        found.push(value as AnyEnvelope);
      } else {
        bad(
          'envelope',
          id,
          result.ok ? 'stored under a different identity' : result.problems.join(', '),
        );
      }
    } catch (error) {
      bad('envelope', id, error instanceof Error ? error.message : 'unreadable');
    }
  }
  return found;
}

async function loadBlobs(store: ObjectStore, bad: Reject): Promise<Digest[]> {
  const found: Digest[] = [];
  for (const id of await store.list('blob')) {
    const bytes = await store.get('blob', id);
    if (bytes !== null && digestBytes(bytes) === id) {
      found.push(id);
    } else {
      bad('blob', id, 'content does not match its identity');
    }
  }
  return found;
}

async function loadRecords<T extends { readonly digest: Digest }>(
  store: ObjectStore,
  kind: ObjectKind,
  verify: (value: unknown) => { readonly ok: boolean; readonly problems: readonly string[] },
  bad: Reject,
): Promise<T[]> {
  const found: T[] = [];
  for (const id of await store.list(kind)) {
    try {
      const value = await readJson(store, kind, id);
      const result = verify(value);
      if (result.ok && (value as T).digest === id) {
        found.push(value as T);
      } else {
        bad(kind, id, result.ok ? 'stored under a different identity' : result.problems.join(', '));
      }
    } catch (error) {
      bad(kind, id, error instanceof Error ? error.message : 'unreadable');
    }
  }
  return found;
}

/**
 * Reduces verified records to index rows. A record can carry a correct digest and still be shaped wrongly, because
 * its digest only proves its bytes were not changed since someone computed it. One such record must not make the
 * whole history unreadable, so a row that cannot be built is reported as corrupt and left out.
 */
function rows<T extends { readonly digest: Digest }, R>(
  kind: ObjectKind,
  records: readonly T[],
  toRow: (record: T) => R,
  bad: Reject,
): R[] {
  const built: R[] = [];
  for (const record of records) {
    try {
      built.push(toRow(record));
    } catch (error) {
      bad(
        kind,
        record.digest,
        `malformed: ${error instanceof Error ? error.message : 'unreadable'}`,
      );
    }
  }
  return built;
}

/**
 * Derives the whole index from the immutable objects. It is a pure function of what the store holds: nothing
 * about when it ran enters the result, so rebuilding it from the same objects gives the same digest.
 */
export async function buildIndex(store: ObjectStore): Promise<HistoryIndex> {
  const corrupt: CorruptObject[] = [];
  const bad: Reject = (kind, id, reason) => {
    corrupt.push({ kind, id, reason });
  };
  const blobs = await loadBlobs(store, bad);
  const envelopes = await loadEnvelopes(store, bad);
  const receipts = await loadRecords<AttemptReceipt>(store, 'receipt', verifyReceipt, bad);
  const aliases = await loadRecords<BehaviorAlias>(store, 'alias', verifyAlias, bad);
  const deltas = await loadRecords<BehavioralDelta>(store, 'delta', verifyDelta, bad);
  const snapshotIds = new Set(blobs);
  const envelopeIds = new Set(envelopes.map(({ digest }) => digest));
  const byId = <T extends { readonly id: Digest }>(a: T, b: T): number => (a.id < b.id ? -1 : 1);
  const body = {
    indexVersion,
    executions: rows(
      'envelope',
      envelopes,
      (envelope) => executionOf(envelope, snapshotIds),
      bad,
    ).sort((a, b) => (a.envelopeId < b.envelopeId ? -1 : 1)),
    receipts: rows('receipt', receipts, (receipt) => receiptOf(receipt, envelopeIds), bad).sort(
      byId,
    ),
    aliases: aliases.sort((a, b) => (a.digest < b.digest ? -1 : 1)),
    deltas: rows('delta', deltas, deltaOf, bad).sort(byId),
    blobs,
    corrupt: corrupt.sort((a, b) => (`${a.kind}${a.id}` < `${b.kind}${b.id}` ? -1 : 1)),
  } satisfies Omit<HistoryIndex, 'digest'>;
  return { ...body, digest: digestOf(body) };
}
