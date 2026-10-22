import { loadSide } from '../compare/side.js';
import type { ComparisonSide } from '../compare/types.js';
import { digestBytes, type Digest } from '../envelope/index.js';
import { checkEvidence } from './evidence-check.js';
import { HistoryError, type AnyEnvelope, type ExecutionDetail } from './history-types.js';
import { verifyReceipt, type AttemptReceipt } from './receipts/receipt.js';
import type { ObjectStore } from './storage/store.js';
import { checkStoredEnvelope } from './stored-envelope.js';

/**
 * Reads records back out of the store. The index is only a cache and a file can change after it was built, so
 * everything returned here is verified again against the identity it was stored under.
 */
export class StoredRecords {
  constructor(private readonly store: ObjectStore) {}

  async envelope(id: Digest): Promise<AnyEnvelope | null> {
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

  async snapshot(envelope: AnyEnvelope): Promise<string | null> {
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

  async receipt(id: Digest): Promise<AttemptReceipt | null> {
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
    receiptIds: readonly Digest[],
    evidenceRoot: string | null,
  ): Promise<ExecutionDetail | null> {
    const envelope = await this.envelope(id);
    if (envelope === null) {
      return null;
    }
    const receipts: AttemptReceipt[] = [];
    for (const receiptId of receiptIds) {
      const receipt = await this.receipt(receiptId);
      if (receipt !== null) {
        receipts.push(receipt);
      }
    }
    return {
      envelope,
      snapshotBody: await this.snapshot(envelope),
      receipts,
      evidence: await checkEvidence(this.store, envelope, evidenceRoot),
    };
  }

  async side(id: Digest): Promise<ComparisonSide> {
    const envelope = await this.envelope(id);
    if (envelope === null) {
      throw new HistoryError('Unknown execution', [id]);
    }
    const loaded = loadSide({ envelope, snapshotBody: await this.snapshot(envelope) });
    if (loaded.kind !== 'loaded') {
      throw new HistoryError('A stored envelope no longer verifies', loaded.problems);
    }
    return loaded.side;
  }
}
