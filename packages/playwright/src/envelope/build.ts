import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import { canonicalization, digestOf, type Digest } from './canonical.js';
import { detailedEffects, observedSection } from './observation.js';
import {
  envelopeVersion,
  type AssertionResult,
  type AttemptIdentity,
  type BehaviorEnvelope,
  type BehaviorIdentity,
  type ConfigurationSection,
  type EvidenceRef,
  type ObservedSection,
  type Provenance,
  type StateSection,
  type StimulusSection,
  type SourceSection,
  type SystemSection,
  type VerificationSection,
} from './types.js';

export interface BuildEnvelopeInput {
  readonly behavior: BehaviorIdentity;
  readonly attempt: AttemptIdentity;
  readonly system: SystemSection;
  readonly source: SourceSection;
  readonly configuration: ConfigurationSection;
  /** The attempt's final snapshot, or `null` when none was produced. */
  readonly snapshot: FinalSnapshotDocument | null;
  readonly snapshotEvidence: EvidenceRef | null;
  readonly stimulus: StimulusSection;
  readonly state: StateSection;
  readonly evidence: readonly EvidenceRef[];
  readonly assertions: readonly AssertionResult[];
  readonly testStatus: VerificationSection['testStatus'];
  readonly provenance: Provenance;
}

/** The conditions and inputs of an experiment. Version 1 envelopes had no stimulus term. */
export function experimentDigest(
  behaviorId: string,
  configuration: Digest,
  stimulus: Digest | null | 'not-recorded',
): Digest {
  return stimulus === 'not-recorded'
    ? digestOf({ behavior: behaviorId, configuration })
    : digestOf({ behavior: behaviorId, configuration, stimulus });
}

/** What was observed and how completely, with every id, time and path removed. */
export function observationDigest(
  snapshot: FinalSnapshotDocument | null,
  observed: ObservedSection,
): Digest | null {
  if (snapshot === null || snapshot.evidence.kind !== 'admitted') {
    return null;
  }
  return digestOf({
    effects: detailedEffects(snapshot),
    completeness: {
      status: observed.completeness.status,
      reasons: [...observed.completeness.reasons].sort(),
    },
    coverage: observed.coverage.participants.map(({ id, status }) => ({ id, status })),
  });
}

function evidenceOrder(left: EvidenceRef, right: EvidenceRef): number {
  const a = `${left.kind}:${left.id}`;
  const b = `${right.kind}:${right.id}`;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function envelopeDigest(envelope: object): Digest {
  return digestOf(envelope);
}

/**
 * Assembles one envelope. Pure: every fingerprint is a function of the sections given here, so equal inputs
 * give equal bytes and a changed input changes exactly the digests that cover it.
 */
export function buildEnvelope(input: BuildEnvelopeInput): BehaviorEnvelope {
  const observed = observedSection({
    snapshot: input.snapshot,
    snapshotEvidence:
      input.snapshotEvidence === null
        ? { state: 'not-produced', reason: 'no-final-snapshot' }
        : { state: 'attached', evidence: input.snapshotEvidence.id },
    participants: input.system.participants,
    attemptId: input.attempt.attemptId,
  });
  const contracts = new Map<Digest, number>();
  for (const assertion of input.assertions) {
    contracts.set(assertion.contractDigest, (contracts.get(assertion.contractDigest) ?? 0) + 1);
  }
  const partial = {
    envelopeVersion,
    kind: 'behavior-envelope',
    canonicalization,
    identity: {
      behavior: input.behavior,
      attempt: input.attempt,
      experiment: experimentDigest(
        input.behavior.id,
        input.configuration.fingerprint,
        input.stimulus.fingerprint,
      ),
      stimulus: input.stimulus.fingerprint,
      observation: observationDigest(input.snapshot, observed),
    },
    system: input.system,
    source: input.source,
    configuration: input.configuration,
    stimulus: input.stimulus,
    observed,
    state: input.state,
    expectations: {
      declaredInTest: [...contracts.entries()]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([contractDigest, assertions]) => ({ contractDigest, assertions })),
    },
    verification: { testStatus: input.testStatus, assertions: input.assertions },
    evidence: [...input.evidence].sort(evidenceOrder),
    provenance: input.provenance,
  } satisfies Omit<BehaviorEnvelope, 'digest'>;
  return { ...partial, digest: envelopeDigest(partial) };
}
