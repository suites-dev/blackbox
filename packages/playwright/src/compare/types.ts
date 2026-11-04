import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import type { Digest, BehaviorEnvelope, StateRecord } from '../envelope/index.js';

export const deltaVersion = 1;

export type ComparisonOutcome =
  'invalid' | 'inconclusive' | 'no-observed-difference' | 'observed-difference';

/** An envelope in the shape the comparator reads, whichever version it was written in. */
export type ComparableEnvelope = BehaviorEnvelope & { readonly sourceVersion: 1 | 2 };

export interface ComparisonSide {
  readonly envelope: ComparableEnvelope;
  /** The final snapshot, only if its exact body matched the digest the envelope recorded. */
  readonly snapshot: FinalSnapshotDocument | null;
  readonly snapshotProblem: string | null;
}

export type CheckResult = 'equal' | 'compatible' | 'differs' | 'unknown';

/** What a check does to the comparison when it does not pass. */
export type CheckEffect = 'none' | 'condition-changed' | 'limits-conclusions' | 'invalidates';

export interface ComparabilityCheck {
  readonly name: string;
  readonly result: CheckResult;
  readonly effect: CheckEffect;
  readonly detail: string;
}

export interface Comparability {
  readonly level: 'identical-experiment' | 'compatible' | 'limited' | 'incomparable';
  readonly checks: readonly ComparabilityCheck[];
}

export interface EffectKey {
  readonly kind: string;
  readonly actor: string;
  readonly side: string;
  readonly operation: string;
  readonly target: string;
}

export interface OutcomeCount {
  readonly count: number;
  readonly outcomes: Readonly<Record<string, number>>;
}

export interface EffectDelta {
  readonly change:
    'newly-observed' | 'not-observed' | 'absent' | 'count-differs' | 'outcome-differs';
  readonly effect: EffectKey;
  readonly reference: OutcomeCount | null;
  readonly head: OutcomeCount | null;
  /** How much the delta says about behavior, not whether the captures differ. */
  readonly inference: 'witnessed' | 'undetermined' | 'definite';
  /** Span identities (`traceId:spanId`) behind each side's count. */
  readonly evidence: { readonly reference: readonly string[]; readonly head: readonly string[] };
}

export interface CoverageDelta extends EffectDelta {
  readonly cause: string;
}

export interface StateDelta {
  readonly subject: string;
  readonly change: 'count-differs' | 'identities-differ';
  readonly reference: Pick<StateRecord, 'count' | 'distinct' | 'digest'>;
  readonly head: Pick<StateRecord, 'count' | 'distinct' | 'digest'>;
  readonly source: { readonly reference: string; readonly head: string };
}

export interface InfrastructureEntry {
  readonly actor: string;
  readonly class: string;
  readonly reference: number;
  readonly head: number;
  readonly evidence: { readonly reference: readonly string[]; readonly head: readonly string[] };
}

export interface AtMostClaim {
  readonly id: string;
  readonly n: number;
  readonly selector: EffectKey;
  /** The authoritative-state subject whose distinct identities are the business operations. */
  readonly stateSubject: string | null;
}

export interface ClaimFinding {
  readonly claim: string;
  readonly side: 'reference' | 'head';
  readonly status: 'refuted' | 'span-excess' | 'suspect' | 'not-refuted' | 'unevaluable';
  readonly basis: 'state' | 'spans' | 'none';
  readonly spans: number;
  readonly distinctRecords: number | null;
  readonly businessOperationsEstablished: boolean;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface SideVerification {
  readonly attemptId: string;
  readonly retry: number;
  readonly testStatus: BehaviorEnvelope['verification']['testStatus'];
  readonly assertions: BehaviorEnvelope['verification']['assertions'];
}

export interface UnresolvedItem {
  readonly kind:
    | 'coverage-explained-difference'
    | 'stimulus-unestablished'
    | 'measurement-basis-differs'
    | 'evidence-unavailable'
    | 'state-reported-on-one-side'
    | 'state-annotations-rejected'
    | 'evidence-truncated'
    | 'stimulus-credentials-unverified';
  readonly detail: string;
}

export interface BehavioralDelta {
  readonly deltaVersion: typeof deltaVersion;
  readonly kind: 'behavioral-delta';
  readonly digest: Digest;
  readonly outcome: ComparisonOutcome;
  readonly reference: {
    readonly envelope: Digest;
    readonly attemptId: string;
    readonly behavior: string;
  };
  readonly head: {
    readonly envelope: Digest;
    readonly attemptId: string;
    readonly behavior: string;
  };
  readonly comparability: Comparability;
  readonly drift: {
    readonly effects: readonly EffectDelta[];
    readonly state: readonly StateDelta[];
  };
  readonly infrastructure: readonly InfrastructureEntry[];
  readonly verification: {
    readonly reference: SideVerification;
    readonly head: SideVerification;
    readonly claims: readonly ClaimFinding[];
  };
  readonly unresolved: readonly UnresolvedItem[];
  readonly coverage: readonly CoverageDelta[];
  readonly association: {
    readonly level: 1;
    readonly reference: {
      readonly commit: string | null;
      readonly workingTree: string;
      readonly fingerprint: Digest | null;
    };
    readonly head: {
      readonly commit: string | null;
      readonly workingTree: string;
      readonly fingerprint: Digest | null;
    };
    readonly relation: 'same-source' | 'different-source' | 'unknown';
    readonly note: string;
  };
  readonly invocation: 'same' | 'unestablished';
  /** Empty unless the behavior ids differ and a recorded alias connects them. */
  readonly behaviorAliases: readonly AliasStep[];
}

/** A recorded alias that was followed to treat two behavior ids as one for this comparison. */
export interface AliasStep {
  readonly alias: Digest;
  readonly from: string;
  readonly to: string;
}

export interface CompareOptions {
  readonly claims: readonly AtMostClaim[];
}
