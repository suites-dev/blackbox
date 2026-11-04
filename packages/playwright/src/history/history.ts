import type { AtMostClaim, BehavioralDelta } from '../compare/types.js';
import type { Digest } from '../envelope/index.js';
import type { AliasBody, BehaviorAlias } from './aliases/alias.js';
import { compareThroughAliases } from './compare-stored.js';
import { collectFindings, type Findings } from './findings.js';
import {
  HistoryError,
  type EvidenceCheck,
  type ExecutionDetail,
  type IngestResult,
  type StoreReport,
} from './history-types.js';
import { Ingestion } from './ingestion/ingest.js';
import {
  behaviorHistory,
  behaviorSummaries,
  type BehaviorSummary,
  type HistoryEntry,
} from './queries.js';
import { StoredRecords } from './reader.js';
import { buildIndex, type HistoryIndex } from './storage/index-build.js';
import { indexMatchesStore, readIndexFile, writeIndexFile } from './storage/index-file.js';
import { ObjectStore, objectKinds, type ObjectKind } from './storage/store.js';

export { HistoryError } from './history-types.js';
export type { EvidenceCheck, ExecutionDetail, IngestResult, StoreReport } from './history-types.js';

/**
 * A local, append-only history. Every record is an immutable content-addressed file; the index is derived from
 * them and can be deleted and rebuilt at any time. There is no mutable head and no lock, so parallel writers
 * cannot corrupt each other.
 */
export class BehaviorHistory {
  #index: HistoryIndex | null = null;
  private readonly ingestion: Ingestion;
  private readonly records: StoredRecords;

  private constructor(
    readonly root: string,
    private readonly store: ObjectStore,
  ) {
    this.ingestion = new Ingestion(store, () => {
      this.#index = null;
    });
    this.records = new StoredRecords(store);
  }

  static open(root: string): Promise<BehaviorHistory> {
    return Promise.resolve(new BehaviorHistory(root, new ObjectStore(root)));
  }

  ingestBlob(bytes: string | Uint8Array): Promise<IngestResult> {
    return this.ingestion.blob(bytes);
  }

  /** Stores a verified envelope, and its final snapshot when the exact bytes the envelope recorded are supplied. */
  ingestEnvelope(envelope: unknown, snapshotBody: string | null): Promise<IngestResult> {
    return this.ingestion.envelope(envelope, snapshotBody);
  }

  ingestReceipt(receipt: unknown): Promise<IngestResult> {
    return this.ingestion.receipt(receipt);
  }

  recordAlias(body: AliasBody): Promise<IngestResult & { readonly alias: BehaviorAlias }> {
    return this.ingestion.alias(body);
  }

  recordComparison(delta: BehavioralDelta): Promise<IngestResult> {
    return this.ingestion.comparison(delta);
  }

  /** The index, brought up to date with the store. It is read from disk when it still matches, else rebuilt. */
  async index(): Promise<HistoryIndex> {
    if (this.#index !== null) {
      return this.#index;
    }
    const cached = await readIndexFile(this.root);
    if (cached !== null && (await indexMatchesStore(this.store, cached))) {
      this.#index = cached;
      return cached;
    }
    return this.rebuildIndex();
  }

  /** Forgets the in-memory index so the next query sees records another process wrote. */
  refresh(): Promise<HistoryIndex> {
    this.#index = null;
    return this.index();
  }

  async rebuildIndex(): Promise<HistoryIndex> {
    const index = await buildIndex(this.store);
    await writeIndexFile(this.root, index);
    this.#index = index;
    return index;
  }

  async behaviors(): Promise<BehaviorSummary[]> {
    return behaviorSummaries(await this.index());
  }

  async behaviorHistory(
    id: string,
    options: { readonly followAliases: boolean },
  ): Promise<HistoryEntry[]> {
    return behaviorHistory(await this.index(), id, options.followAliases);
  }

  findings(id: string, options: { readonly followAliases: boolean }): Promise<Findings> {
    return collectFindings(this, id, options);
  }

  /** One execution, its receipts, and where each piece of its evidence stands. */
  async execution(
    id: Digest,
    options: { readonly evidenceRoot: string | null } = { evidenceRoot: null },
  ): Promise<ExecutionDetail | null> {
    const receipts = (await this.index()).receipts
      .filter(({ envelope }) => envelope === id)
      .map((receipt) => receipt.id);
    return this.records.execution(id, receipts, options.evidenceRoot);
  }

  async verifyEvidence(id: Digest, evidenceRoot: string): Promise<readonly EvidenceCheck[]> {
    const detail = await this.execution(id, { evidenceRoot });
    if (detail === null) {
      throw new HistoryError('Unknown execution', [id]);
    }
    return detail.evidence;
  }

  /** Compares two stored executions with the comparator, optionally keeping the result as a record. */
  async compare(
    referenceId: Digest,
    headId: Digest,
    options: { readonly claims: readonly AtMostClaim[]; readonly record: boolean },
  ): Promise<BehavioralDelta> {
    const reference = await this.records.side(referenceId);
    const head = await this.records.side(headId);
    const aliases = (await this.index()).aliases;
    let delta: BehavioralDelta;
    try {
      delta = compareThroughAliases(reference, head, { aliases, claims: options.claims });
    } catch (error) {
      // A record that verified but cannot be read as a comparison input is reported, not thrown as a TypeError.
      throw new HistoryError('A stored record could not be compared', [
        error instanceof Error ? error.message : String(error),
      ]);
    }
    if (options.record) {
      await this.recordComparison(delta);
    }
    return delta;
  }

  async verifyStore(): Promise<StoreReport> {
    const index = await this.rebuildIndex();
    const counts = { envelope: 0, blob: 0, receipt: 0, alias: 0, delta: 0 } satisfies Record<
      ObjectKind,
      number
    >;
    for (const kind of objectKinds) {
      counts[kind] = (await this.store.list(kind)).length;
    }
    return {
      objects: counts,
      corrupt: index.corrupt,
      interruptedWrites: await this.store.interrupted(),
      indexDigest: index.digest,
    };
  }
}
