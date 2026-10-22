import type {
  Digest,
  BehaviorEnvelope,
  EvidenceRef,
  LegacyBehaviorEnvelope,
} from '../envelope/index.js';
import type { HistoryIndex } from './storage/index-build.js';
import type { AttemptReceipt } from './receipts/receipt.js';
import type { ObjectKind } from './storage/store.js';

export type AnyEnvelope = BehaviorEnvelope | LegacyBehaviorEnvelope;

export class HistoryError extends Error {
  constructor(
    message: string,
    readonly problems: readonly string[],
  ) {
    super(`${message}: ${problems.join(', ')}`);
  }
}

export interface IngestResult {
  readonly id: Digest;
  /** `false` when exactly this record was already stored: ingesting twice changes nothing. */
  readonly created: boolean;
}

export interface EvidenceCheck {
  readonly kind: EvidenceRef['kind'];
  readonly id: Digest;
  readonly locator: EvidenceRef['locator'];
  /** `stored`: the bytes are in the store and match. `verified`/`mismatch`/`missing`: re-checked against files. `refused`: the locator leaves the evidence root. */
  readonly status: 'stored' | 'verified' | 'mismatch' | 'missing' | 'not-checked' | 'refused';
}

export interface ExecutionDetail {
  readonly envelope: AnyEnvelope;
  readonly snapshotBody: string | null;
  readonly receipts: readonly AttemptReceipt[];
  readonly evidence: readonly EvidenceCheck[];
}

export interface StoreReport {
  readonly objects: Readonly<Record<ObjectKind, number>>;
  readonly corrupt: HistoryIndex['corrupt'];
  readonly interruptedWrites: readonly string[];
  readonly indexDigest: Digest;
}
