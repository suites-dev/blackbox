import type {
  EffectCapture, EffectRecorder, EffectRecorderAssessment, ObservedEffect,
} from '@suites/blackbox-effects';

import type { EffectSnapshotArtifact } from '../evaluation/artifact-types.js';

/** Expected observed facts. Native asymmetric matchers are supported at each scalar leaf. */
export type ExpectedEmission = Readonly<Partial<Record<
  'kind' | 'operation' | 'target' | 'actor' | 'outcome', unknown
>>> & Readonly<Partial<{ attributes: Readonly<Record<string, unknown>> }>>;

export interface EmissionAssertionReport {
  readonly matcher: string;
  readonly expected: string;
  readonly negated: boolean;
  readonly assessment: EffectRecorderAssessment;
  readonly evidence: EffectSnapshotArtifact | null;
  readonly witnesses: readonly ObservedEffect[];
  readonly otherCapture: EffectCapture['identity'] | null;
}

export interface EmissionOwner {
  readonly unavailable: () => string | null;
  readonly describe: (text: string) => string;
  readonly report: (report: EmissionAssertionReport) => Promise<void>;
  readonly evidence: EffectSnapshotArtifact | null;
  readonly redactSnapshot: (yaml: string) => string;
}

export type EmissionPredicate = (effect: ObservedEffect) => boolean | null;
export type { EffectCapture, EffectRecorder };
