import { loadSide } from '../compare/side.js';
import type { ComparisonSide } from '../compare/types.js';
import { digestBytes, type Digest } from '../envelope/index.js';
import { checkEvidence } from './evidence-check.js';
import { HistoryError, type AnyEnvelope, type ExecutionDetail } from './history-types.js';
import { verifyNativeResult, type NativeResult } from './receipts/native-result.js';
import { verifyReceipt, type AttemptReceipt } from './receipts/receipt.js';
import { readWithReason, type ObjectStore } from './storage/store.js';
import { checkStoredEnvelope } from './stored-envelope.js';

/**
 * Reads records back out of the store. The index is only a cache and a file can change after it was built, so
 * everything returned here is verified again against the identity it was stored under.
 */
export class StoredRecords {
  constructor(private readonly store: ObjectStore) {}

  private async read(kind: 'envelope' | 'blob' | 'receipt', id: Digest): Promise<Buffer | null> {
    const { bytes, problem } = await readWithReason(this.store, kind, id);
    if (problem !== null) {
      throw new HistoryError(`A stored ${kind} cannot be read`, [id, problem]);
    }
    return bytes;
  }

  async envelope(id: Digest): Promise<AnyEnvelope | null> {
    const bytes = await this.read('envelope', id);
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
    const bytes = await this.read('blob', finalSnapshot.evidence);
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
    const bytes = await this.read('receipt', id);
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

  async nativeResult(id: Digest): Promise<NativeResult | null> {
    const bytes = await this.read('receipt', id);
    if (bytes === null) { return null; }
    try {
      const value: unknown = JSON.parse(bytes.toString('utf8'));
      if (verifyNativeResult(value).ok && (value as NativeResult).digest === id) { return value as NativeResult; }
    } catch { /* reported below */ }
    throw new HistoryError('A stored Playwright result no longer verifies', [id]);
  }

  /** One execution, its receipts, and where each piece of its evidence stands. */
  async execution(
    id: Digest,
    receiptIds: readonly Digest[],
    resultIds: readonly Digest[],
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
    const nativeResults: NativeResult[] = [];
    for (const resultId of resultIds) {
      const result = await this.nativeResult(resultId);
      if (result === null) { throw new HistoryError('A stored Playwright result disappeared', [resultId]); }
      if (result.envelope === id && result.attemptId === envelope.identity.attempt.attemptId) { nativeResults.push(result); }
    }
    const statuses = [...new Set(nativeResults.map(({ status }) => status))];
    return {
      envelope,
      nativeResults,
      finalStatus: statuses.length === 0 ? null : statuses.length === 1 ? statuses[0] : 'conflicting',
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
