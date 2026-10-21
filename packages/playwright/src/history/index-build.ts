import type { BehavioralDelta } from '../compare/types.js';
import { digestBytes, digestOf, type Digest } from '../envelope/canonical.js';
import type { BehaviorEnvelope, LegacyBehaviorEnvelope } from '../envelope/types.js';
import { verifyEnvelope } from '../envelope/verify.js';
import { verifyAlias, type BehaviorAlias } from './alias.js';
import {
  receiptStatus,
  verifyReceipt,
  type AttemptReceipt,
  type ReceiptStatus,
} from './receipt.js';
import { verifyDelta } from './records.js';
import type { ObjectKind, ObjectStore } from './store.js';

export const indexVersion = 1;

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

type AnyEnvelope = BehaviorEnvelope | LegacyBehaviorEnvelope;

function stimulusOf(envelope: AnyEnvelope): Digest | null {
  return 'stimulus' in envelope.identity ? envelope.identity.stimulus : null;
}

function executionOf(envelope: AnyEnvelope, snapshots: ReadonlySet<Digest>): IndexedExecution {
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

function receiptOf(receipt: AttemptReceipt, envelopes: ReadonlySet<Digest>): IndexedReceipt {
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

function deltaOf(delta: BehavioralDelta): IndexedDelta {
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
    executions: envelopes
      .map((envelope) => executionOf(envelope, snapshotIds))
      .sort((a, b) => (a.envelopeId < b.envelopeId ? -1 : 1)),
    receipts: receipts.map((receipt) => receiptOf(receipt, envelopeIds)).sort(byId),
    aliases: aliases.sort((a, b) => (a.digest < b.digest ? -1 : 1)),
    deltas: deltas.map(deltaOf).sort(byId),
    blobs,
    corrupt: corrupt.sort((a, b) => (`${a.kind}${a.id}` < `${b.kind}${b.id}` ? -1 : 1)),
  } satisfies Omit<HistoryIndex, 'digest'>;
  return { ...body, digest: digestOf(body) };
}
