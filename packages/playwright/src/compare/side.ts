import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import {
  digestBytes,
  type BehaviorEnvelope,
  type LegacyBehaviorEnvelope,
} from '../envelope/index.js';
import { verifyEnvelope } from '../envelope/verify.js';
import type { ComparableEnvelope, ComparisonSide } from './types.js';

export type LoadedSide =
  | { readonly kind: 'loaded'; readonly side: ComparisonSide }
  | { readonly kind: 'rejected'; readonly problems: readonly string[] };

function isLegacy(
  value: BehaviorEnvelope | LegacyBehaviorEnvelope,
): value is LegacyBehaviorEnvelope {
  return value.envelopeVersion === 1;
}

/** A version 1 envelope read as version 2 with every field it never had marked as unavailable. */
function normalized(envelope: BehaviorEnvelope | LegacyBehaviorEnvelope): ComparableEnvelope {
  if (!isLegacy(envelope)) {
    return { ...envelope, sourceVersion: 2 };
  }
  return {
    ...envelope,
    envelopeVersion: 2,
    sourceVersion: 1,
    identity: { ...envelope.identity, stimulus: null },
    configuration: {
      ...envelope.configuration,
      capture: { ...envelope.configuration.capture, noiseProfile: 'none' },
    },
    stimulus: {
      state: 'unavailable',
      activities: [],
      unscopedRequests: 0,
      opaqueRequests: 0,
      fingerprint: null,
    },
    state: { records: [], rejected: 0 },
  };
}

function isSnapshot(value: unknown): value is FinalSnapshotDocument {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'final-snapshot' &&
    'schemaVersion' in value &&
    value.schemaVersion === 1
  );
}

/** Excerpts written before infrastructure classification existed are unclassified, not malformed. */
function withClassification(snapshot: FinalSnapshotDocument): FinalSnapshotDocument {
  if (snapshot.evidence.kind !== 'admitted') {
    return snapshot;
  }
  const { evidence } = snapshot;
  return {
    ...snapshot,
    evidence: {
      ...evidence,
      observations: {
        ...evidence.observations,
        excerpts: evidence.observations.excerpts.map((excerpt) => ({
          ...excerpt,
          infrastructure:
            (excerpt.infrastructure as unknown) === 'connection-pool' ||
            (excerpt.infrastructure as unknown) === 'connection-establishment'
              ? excerpt.infrastructure
              : null,
        })),
      },
    },
  };
}

function snapshotOf(
  envelope: ComparableEnvelope,
  body: string | null,
): { readonly snapshot: FinalSnapshotDocument | null; readonly problem: string | null } {
  const { finalSnapshot } = envelope.observed;
  if (finalSnapshot.state !== 'attached') {
    return { snapshot: null, problem: 'the attempt produced no final snapshot' };
  }
  if (body === null) {
    return { snapshot: null, problem: 'the final snapshot body was not supplied' };
  }
  if (digestBytes(body) !== finalSnapshot.evidence) {
    return {
      snapshot: null,
      problem: 'the final snapshot does not match the digest the envelope recorded',
    };
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return isSnapshot(parsed)
      ? { snapshot: withClassification(parsed), problem: null }
      : { snapshot: null, problem: 'the final snapshot has an unsupported shape' };
  } catch {
    return { snapshot: null, problem: 'the final snapshot is not valid JSON' };
  }
}

/**
 * Verifies an envelope and the snapshot it references. A snapshot whose bytes do not match the recorded
 * digest is never used: the comparison then proceeds without observations and says so.
 */
export function loadSide(input: {
  readonly envelope: unknown;
  readonly snapshotBody: string | null;
}): LoadedSide {
  const verified = verifyEnvelope(input.envelope);
  if (!verified.ok) {
    return { kind: 'rejected', problems: verified.problems };
  }
  const document = input.envelope as BehaviorEnvelope | LegacyBehaviorEnvelope;
  const envelope = normalized(document);
  const { snapshot, problem } = snapshotOf(envelope, input.snapshotBody);
  return { kind: 'loaded', side: { envelope, snapshot, snapshotProblem: problem } };
}
