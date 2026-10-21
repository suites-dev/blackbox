import { loadSide } from '../compare/side.js';
import type { AtMostClaim, BehavioralDelta, ComparisonSide } from '../compare/types.js';
import { canonicalize, digestBytes, type Digest } from '../envelope/canonical.js';
import { verifyEnvelope } from '../envelope/verify.js';
import { buildAlias, verifyAlias, type AliasBody, type BehaviorAlias } from './aliases/alias.js';
import { compareThroughAliases } from './compare-stored.js';
import { checkEvidence } from './evidence-check.js';
import { checkStoredEnvelope } from './stored-envelope.js';
import { collectFindings, type Findings } from './findings.js';
import {
  HistoryError,
  type AnyEnvelope,
  type EvidenceCheck,
  type ExecutionDetail,
  type IngestResult,
  type StoreReport,
} from './history-types.js';
import { buildIndex, type HistoryIndex } from './storage/index-build.js';
import { indexMatchesStore, readIndexFile, writeIndexFile } from './storage/index-file.js';
import {
  behaviorHistory,
  behaviorSummaries,
  type BehaviorSummary,
  type HistoryEntry,
} from './queries.js';
import { verifyReceipt, type AttemptReceipt } from './receipts/receipt.js';
import { verifyDelta } from './storage/records.js';
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

  private constructor(
    readonly root: string,
    private readonly store: ObjectStore,
  ) {}

  static open(root: string): Promise<BehaviorHistory> {
    return Promise.resolve(new BehaviorHistory(root, new ObjectStore(root)));
  }

  private async put(
    kind: ObjectKind,
    id: Digest,
    bytes: string | Uint8Array,
  ): Promise<IngestResult> {
    const { created } = await this.store.put(kind, id, bytes);
    this.#index = null;
    return { id, created };
  }

  ingestBlob(bytes: string | Uint8Array): Promise<IngestResult> {
    return this.put('blob', digestBytes(bytes), bytes);
  }

  /** Stores a verified envelope, and its final snapshot when the exact bytes the envelope recorded are supplied. */
  async ingestEnvelope(envelope: unknown, snapshotBody: string | null): Promise<IngestResult> {
    const verified = verifyEnvelope(envelope);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid envelope', verified.problems);
    }
    const document = envelope as AnyEnvelope;
    const { finalSnapshot } = document.observed;
    if (snapshotBody !== null) {
      if (
        finalSnapshot.state !== 'attached' ||
        digestBytes(snapshotBody) !== finalSnapshot.evidence
      ) {
        throw new HistoryError('Refusing a snapshot the envelope does not reference', ['snapshot']);
      }
      await this.ingestBlob(snapshotBody);
    }
    return this.put('envelope', document.digest, canonicalize(document));
  }

  async ingestReceipt(receipt: unknown): Promise<IngestResult> {
    const verified = verifyReceipt(receipt);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid receipt', verified.problems);
    }
    const document = receipt as AttemptReceipt;
    return this.put('receipt', document.digest, canonicalize(document));
  }

  async recordAlias(body: AliasBody): Promise<IngestResult & { readonly alias: BehaviorAlias }> {
    const alias = buildAlias(body);
    const verified = verifyAlias(alias);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid alias', verified.problems);
    }
    return { ...(await this.put('alias', alias.digest, canonicalize(alias))), alias };
  }

  async recordComparison(delta: BehavioralDelta): Promise<IngestResult> {
    const verified = verifyDelta(delta);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid comparison', verified.problems);
    }
    return this.put('delta', delta.digest, canonicalize(delta));
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

  /** A stored envelope, re-verified on every read: the index is a cache and a file can change after it was built. */
  private async envelopeOf(id: Digest): Promise<AnyEnvelope | null> {
    const bytes = await this.store.get('envelope', id);
    if (bytes === null) {
      return null;
    }
    const checked = checkStoredEnvelope(bytes, id);
    if (checked.ok) {
      return checked.envelope;
    }
    throw new HistoryError('A stored envelope no longer verifies', [id, ...checked.problems]);
  }

  private async snapshotOf(envelope: AnyEnvelope): Promise<string | null> {
    const { finalSnapshot } = envelope.observed;
    if (finalSnapshot.state !== 'attached') {
      return null;
    }
    const bytes = await this.store.get('blob', finalSnapshot.evidence);
    if (bytes === null) {
      return null;
    }
    if (digestBytes(bytes) !== finalSnapshot.evidence) {
      throw new HistoryError('A stored snapshot no longer matches its identity', [
        finalSnapshot.evidence,
      ]);
    }
    return bytes.toString('utf8');
  }

  private async receiptOf(id: Digest): Promise<AttemptReceipt | null> {
    const bytes = await this.store.get('receipt', id);
    if (bytes === null) {
      return null;
    }
    try {
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (verifyReceipt(value).ok && (value as AttemptReceipt).digest === id) {
        return value as AttemptReceipt;
      }
    } catch {
      // unparsable: reported below
    }
    throw new HistoryError('A stored receipt no longer verifies', [id]);
  }

  /** One execution, its receipts, and where each piece of its evidence stands. */
  async execution(
    id: Digest,
    options: { readonly evidenceRoot: string | null } = { evidenceRoot: null },
  ): Promise<ExecutionDetail | null> {
    const envelope = await this.envelopeOf(id);
    if (envelope === null) {
      return null;
    }
    const receipts: AttemptReceipt[] = [];
    for (const item of (await this.index()).receipts.filter(
      ({ envelope: digest }) => digest === id,
    )) {
      const receipt = await this.receiptOf(item.id);
      if (receipt !== null) {
        receipts.push(receipt);
      }
    }
    return {
      envelope,
      snapshotBody: await this.snapshotOf(envelope),
      receipts,
      evidence: await checkEvidence(this.store, envelope, options.evidenceRoot),
    };
  }

  async verifyEvidence(id: Digest, evidenceRoot: string): Promise<readonly EvidenceCheck[]> {
    const detail = await this.execution(id, { evidenceRoot });
    if (detail === null) {
      throw new HistoryError('Unknown execution', [id]);
    }
    return detail.evidence;
  }

  private async sideOf(id: Digest): Promise<ComparisonSide> {
    const envelope = await this.envelopeOf(id);
    if (envelope === null) {
      throw new HistoryError('Unknown execution', [id]);
    }
    const loaded = loadSide({ envelope, snapshotBody: await this.snapshotOf(envelope) });
    if (loaded.kind !== 'loaded') {
      throw new HistoryError('A stored envelope no longer verifies', loaded.problems);
    }
    return loaded.side;
  }

  /** Compares two stored executions with the Milestone 3 comparator, optionally keeping the result as a record. */
  async compare(
    referenceId: Digest,
    headId: Digest,
    options: { readonly claims: readonly AtMostClaim[]; readonly record: boolean },
  ): Promise<BehavioralDelta> {
    const delta = compareThroughAliases(await this.sideOf(referenceId), await this.sideOf(headId), {
      aliases: (await this.index()).aliases,
      claims: options.claims,
    });
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
