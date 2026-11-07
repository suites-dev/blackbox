import type { EffectContractBuilderApi, EffectCountOperator, EffectSelector } from '../contract.js';
import type { EffectGraph, EffectRelation, ObservedEffect } from '../graph/model.js';
import type { VerificationStatus } from '../verification/model.js';

/** Labels supplied by the caller; the framework-neutral package does not authenticate ownership. */
export interface EffectCaptureIdentity {
  readonly sessionId: string;
  readonly executionId: string;
  readonly scopeId: string;
  readonly captureId: string;
  readonly activityIds: readonly string[];
}

export type EffectCaptureCoverage = EffectGraph['quality'] & { readonly closed: boolean };

interface CaptureMetadata {
  readonly identity: EffectCaptureIdentity;
  readonly coverage: EffectCaptureCoverage;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

/** A selection of occurrences from one immutable capture, never a callable dependency stub. */
export interface EffectRecorder extends CaptureMetadata {
  readonly selector: EffectSelector;
  readonly emissions: readonly ObservedEffect[];
  readonly possibleEmissions: readonly ObservedEffect[];
}

type SelectorMethod =
  'http' | 'rpc' | 'db' | 'cache' | 'message' | 'business' | 'internal' | 'span';

export type EffectCapture = CaptureMetadata & {
  readonly [Method in SelectorMethod]: (
    ...fields: Parameters<EffectContractBuilderApi[Method]>
  ) => EffectRecorder;
};

export type EffectCaptureInput = { readonly identity: EffectCaptureIdentity } & (
  { readonly graph: EffectGraph } | { readonly unavailable: { readonly reason: string } }
);

/** null means the requested fact is not known. A true result cannot resolve an uncertain selector. */
export type EffectEmissionPredicate = (emission: ObservedEffect) => boolean | null;

export interface EffectRecorderCount {
  readonly operator: EffectCountOperator;
  readonly count: number;
}

export interface EffectRecorderAssessment {
  readonly status: VerificationStatus;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly possibleEvidence: readonly string[];
  readonly relations: readonly EffectRelation[];
  readonly identity: EffectCaptureIdentity;
  readonly coverage: EffectCaptureCoverage;
}

export interface EffectRecorderCountAssessment extends EffectRecorderAssessment {
  readonly lowerBound: number;
  /** null represents an unbounded upper count, keeping assessments JSON serializable. */
  readonly upperBound: number | null;
}

export type EffectSnapshotValue =
  | null
  | string
  | number
  | boolean
  | readonly EffectSnapshotValue[]
  | { readonly [key: string]: EffectSnapshotValue };

interface EffectSnapshotProjection {
  /** Explicitly choose the observed fields that belong in the reviewed baseline. */
  readonly project: (emission: ObservedEffect) => EffectSnapshotValue;
}

export type EffectSnapshotOptions =
  | EffectSnapshotProjection
  | (EffectSnapshotProjection & {
      readonly normalize: (value: EffectSnapshotValue) => EffectSnapshotValue;
    });
