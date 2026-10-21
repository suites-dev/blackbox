import type { BehavioralDelta } from '../../compare/types.js';
import type { Digest } from '../../envelope/canonical.js';
import type { BehaviorEnvelope, LegacyBehaviorEnvelope } from '../../envelope/types.js';
import { receiptStatus, type AttemptReceipt, type ReceiptStatus } from '../receipts/receipt.js';
import type { ObjectKind } from './store.js';

export interface IndexedExecution {
  readonly envelopeId: Digest;
  readonly behaviorId: string;
  readonly basis: string;
  readonly derivedId: string;
  readonly attemptId: string;
  readonly retry: number;
  readonly invocation: string | null;
  readonly runnerTestId: string;
  readonly capturedAt: string;
  readonly testStatus: string;
  readonly source: {
    readonly commit: string | null;
    readonly tree: string | null;
    readonly workingTree: string;
    readonly fingerprint: Digest | null;
  };
  readonly configuration: Digest;
  readonly experiment: Digest;
  readonly stimulus: Digest | null;
  readonly observation: Digest | null;
  readonly completeness: string;
  readonly snapshot: 'stored' | 'missing' | 'not-produced';
  readonly snapshotId: Digest | null;
  readonly failedAssertions: number;
  readonly inconclusiveAssertions: number;
}

export interface IndexedReceipt {
  readonly id: Digest;
  readonly receiptId: string;
  readonly behaviorId: string;
  readonly derivedId: string;
  readonly basis: string;
  readonly retry: number;
  readonly invocation: string | null;
  readonly runnerTestId: string;
  readonly at: string;
  readonly status: ReceiptStatus;
  readonly failure: AttemptReceipt['failure'];
  readonly envelope: Digest | null;
  readonly envelopeStored: boolean;
  readonly sandboxId: string | null;
}

export interface IndexedDelta {
  readonly id: Digest;
  readonly outcome: string;
  readonly behavior: string;
  readonly reference: { readonly envelope: Digest; readonly attemptId: string };
  readonly head: { readonly envelope: Digest; readonly attemptId: string };
  readonly refutedClaims: readonly string[];
  readonly unresolved: number;
}

export interface CorruptObject {
  readonly kind: ObjectKind;
  readonly id: Digest;
  readonly reason: string;
}

export type AnyEnvelope = BehaviorEnvelope | LegacyBehaviorEnvelope;

function stimulusOf(envelope: AnyEnvelope): Digest | null {
  return 'stimulus' in envelope.identity ? envelope.identity.stimulus : null;
}

export function executionOf(
  envelope: AnyEnvelope,
  snapshots: ReadonlySet<Digest>,
): IndexedExecution {
  const { finalSnapshot } = envelope.observed;
  const ci = envelope.provenance.ci;
  const assertions = envelope.verification.assertions;
  return {
    envelopeId: envelope.digest,
    behaviorId: envelope.identity.behavior.id,
    basis: envelope.identity.behavior.basis,
    derivedId: envelope.identity.behavior.derivedId,
    attemptId: envelope.identity.attempt.attemptId,
    retry: envelope.identity.attempt.retry,
    invocation: Object.hasOwn(ci, 'invocation') ? ci.invocation : null,
    runnerTestId: envelope.provenance.test.runnerTestId,
    capturedAt: envelope.provenance.capturedAt,
    testStatus: envelope.verification.testStatus.status,
    source: {
      commit: envelope.source.commit,
      tree: envelope.source.tree,
      workingTree: envelope.source.workingTree.state,
      fingerprint: envelope.source.fingerprint,
    },
    configuration: envelope.configuration.fingerprint,
    experiment: envelope.identity.experiment,
    stimulus: stimulusOf(envelope),
    observation: envelope.identity.observation,
    completeness: envelope.observed.completeness.status,
    snapshot:
      finalSnapshot.state !== 'attached'
        ? 'not-produced'
        : snapshots.has(finalSnapshot.evidence)
          ? 'stored'
          : 'missing',
    snapshotId: finalSnapshot.state === 'attached' ? finalSnapshot.evidence : null,
    failedAssertions: assertions.filter(({ outcome }) => outcome === 'failed').length,
    inconclusiveAssertions: assertions.filter(({ outcome }) => outcome === 'inconclusive').length,
  };
}

export function receiptOf(receipt: AttemptReceipt, envelopes: ReadonlySet<Digest>): IndexedReceipt {
  return {
    id: receipt.digest,
    receiptId: receipt.attempt.receiptId,
    behaviorId: receipt.behavior.id,
    derivedId: receipt.behavior.derivedId,
    basis: receipt.behavior.basis,
    retry: receipt.attempt.retry,
    invocation: receipt.invocation,
    runnerTestId: receipt.test.runnerTestId,
    at: receipt.lifecycle[0].at,
    status: receiptStatus(receipt),
    failure: receipt.failure,
    envelope: receipt.envelope,
    envelopeStored: receipt.envelope !== null && envelopes.has(receipt.envelope),
    sandboxId: receipt.attempt.sandboxId,
  };
}

export function deltaOf(delta: BehavioralDelta): IndexedDelta {
  return {
    id: delta.digest,
    outcome: delta.outcome,
    behavior: delta.reference.behavior,
    reference: { envelope: delta.reference.envelope, attemptId: delta.reference.attemptId },
    head: { envelope: delta.head.envelope, attemptId: delta.head.attemptId },
    refutedClaims: [
      ...new Set(
        delta.verification.claims
          .filter(({ status }) => status === 'refuted')
          .map(({ claim }) => claim),
      ),
    ].sort(),
    unresolved: delta.unresolved.length,
  };
}
