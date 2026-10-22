import { snapshotShapeProblems } from '../../compare/snapshot-shape.js';
import type { BehavioralDelta } from '../../compare/types.js';
import { canonicalize, digestBytes, type Digest } from '../../envelope/index.js';
import { verifyEnvelope } from '../../envelope/verify.js';
import { buildAlias, verifyAlias, type AliasBody, type BehaviorAlias } from '../aliases/alias.js';
import { HistoryError, type AnyEnvelope, type IngestResult } from '../history-types.js';
import { verifyReceipt, type AttemptReceipt } from '../receipts/receipt.js';
import { verifyDelta } from '../storage/records.js';
import type { ObjectKind, ObjectStore } from '../storage/store.js';

function snapshotBodyProblems(body: string): string[] {
  try {
    return snapshotShapeProblems(JSON.parse(body));
  } catch {
    return ['not JSON'];
  }
}

/**
 * Verifies a record and writes it once. Nothing is stored that fails its own verification, and nothing is ever
 * overwritten: writing the same record again is a no-op.
 */
export class Ingestion {
  constructor(
    private readonly store: ObjectStore,
    /** Called after every write, so a cached index can be dropped. */
    private readonly wrote: () => void,
  ) {}

  private async put(
    kind: ObjectKind,
    id: Digest,
    bytes: string | Uint8Array,
  ): Promise<IngestResult> {
    const { created } = await this.store.put(kind, id, bytes);
    this.wrote();
    return { id, created };
  }

  blob(bytes: string | Uint8Array): Promise<IngestResult> {
    return this.put('blob', digestBytes(bytes), bytes);
  }

  /** Stores a verified envelope, and its final snapshot when the exact bytes the envelope recorded are supplied. */
  async envelope(envelope: unknown, snapshotBody: string | null): Promise<IngestResult> {
    const verified = verifyEnvelope(envelope);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid envelope', verified.problems);
    }
    const document = envelope as AnyEnvelope;
    const { finalSnapshot } = document.observed;
    if (snapshotBody !== null) {
      const shape = snapshotBodyProblems(snapshotBody);
      if (shape.length > 0) {
        throw new HistoryError('Refusing a malformed final snapshot', shape);
      }
      if (
        finalSnapshot.state !== 'attached' ||
        digestBytes(snapshotBody) !== finalSnapshot.evidence
      ) {
        throw new HistoryError('Refusing a snapshot the envelope does not reference', ['snapshot']);
      }
      await this.blob(snapshotBody);
    }
    return this.put('envelope', document.digest, canonicalize(document));
  }

  async receipt(receipt: unknown): Promise<IngestResult> {
    const verified = verifyReceipt(receipt);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid receipt', verified.problems);
    }
    const document = receipt as AttemptReceipt;
    return this.put('receipt', document.digest, canonicalize(document));
  }

  async alias(body: AliasBody): Promise<IngestResult & { readonly alias: BehaviorAlias }> {
    const alias = buildAlias(body);
    const verified = verifyAlias(alias);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid alias', verified.problems);
    }
    return { ...(await this.put('alias', alias.digest, canonicalize(alias))), alias };
  }

  async comparison(delta: BehavioralDelta): Promise<IngestResult> {
    const verified = verifyDelta(delta);
    if (!verified.ok) {
      throw new HistoryError('Refusing an invalid comparison', verified.problems);
    }
    return this.put('delta', delta.digest, canonicalize(delta));
  }
}
