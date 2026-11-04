import { projectEffects, type EffectGraph } from '@suites/blackbox-effects';

import type { ScopedObservationReadResult } from '../activities/scoped-observations.js';
import { createEffectSnapshotArtifact } from './evaluation/artifact.js';
import type { EffectSnapshotArtifact } from './evaluation/artifact-types.js';

export const finalSnapshotAttachment = 'blackbox-effects-final';

/** What the collector recorded about its own shutdown. It says nothing about what was observed. */
export type CollectorFinalization =
  | {
      readonly state: 'found';
      readonly receiver: string;
      readonly shutdown: string;
      readonly acceptedRequests: number;
      readonly acceptedSpans: number;
      readonly activatedServices: readonly string[];
      readonly failure: string | null;
    }
  | { readonly state: 'missing' | 'corrupt' | 'unreadable'; readonly message: string };

export interface FinalSnapshotInput {
  readonly attempt: {
    readonly testId: string;
    readonly retry: number;
    readonly status: string;
    readonly expectedStatus: string;
    readonly errorCount: number;
    readonly stopReason: string;
  };
  readonly collector: CollectorFinalization;
  /** `null` when the attempt completed no stimulus activity, so there was nothing to select. */
  readonly stimuli: readonly { readonly activityId: string; readonly purpose: string }[] | null;
  readonly read: ScopedObservationReadResult | null;
}

export type ObservationState =
  'admitted' | 'no-stimulus' | 'unavailable' | 'rejected' | 'projection-rejected';

export interface FinalSnapshotDocument {
  readonly schemaVersion: 1;
  readonly kind: 'final-snapshot';
  readonly attempt: FinalSnapshotInput['attempt'];
  /** Collection finalization: the collector stopped and its retained inventory matched what it acknowledged. */
  readonly finalization: { readonly collector: CollectorFinalization };
  readonly stimuli: {
    readonly state: 'none' | 'selected';
    readonly activities: NonNullable<FinalSnapshotInput['stimuli']>;
  };
  /** What the final read of the attempt's own activities returned. */
  readonly observation: {
    readonly state: ObservationState;
    readonly message: string;
    readonly payloadCount: number;
    readonly diagnostics: readonly string[];
    readonly missingActivityTraces: readonly string[];
    readonly observedServices: readonly string[];
    readonly activatedWithoutObservation: readonly string[];
  };
  /**
   * Demonstrated completeness of the observation. It is independent of finalization: a collector that shut
   * down cleanly proves no span was lost after acceptance, not that every participant emitted its spans.
   */
  readonly completeness: {
    readonly status: 'not-demonstrated' | 'unavailable';
    readonly closed: false;
    readonly attestation: 'none';
    readonly finalizationImpliesCompleteness: false;
    readonly reasons: readonly string[];
  };
  readonly evidence: EffectSnapshotArtifact | { readonly kind: 'not-admitted' };
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function graphOf(
  read: Extract<ScopedObservationReadResult, { kind: 'admitted' }>,
):
  | { readonly kind: 'projected'; readonly graph: EffectGraph }
  | { readonly kind: 'rejected'; readonly message: string } {
  try {
    return {
      kind: 'projected',
      graph: projectEffects({
        format: 'otlp-json',
        scopeId: read.scopeId,
        payloads: read.payloads,
      }),
    };
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return { kind: 'rejected', message: `observation rejected: ${error.message}` };
  }
}

function collectorReasons(collector: CollectorFinalization): string[] {
  if (collector.state !== 'found') {
    return [`collector-lifecycle-${collector.state}`];
  }
  return [
    ...(collector.shutdown === 'complete' ? [] : [`collector-shutdown-${collector.shutdown}`]),
    ...(collector.receiver === 'stopped' ? [] : [`collector-receiver-${collector.receiver}`]),
    ...(collector.failure === null ? [] : ['collector-failure']),
  ];
}

function attemptReasons(attempt: FinalSnapshotInput['attempt']): string[] {
  return attempt.status === 'interrupted' || attempt.status === 'timedOut'
    ? [`attempt-${attempt.status}`]
    : [];
}

/**
 * Builds the final snapshot of one attempt from what it retained. Pure: nothing here reads a file or a
 * collector, so every state, including missing and rejected telemetry, is constructible in a test.
 */
export function buildFinalSnapshot(input: FinalSnapshotInput): FinalSnapshotDocument {
  const stimuli = input.stimuli ?? [];
  const base = {
    schemaVersion: 1,
    kind: 'final-snapshot',
    attempt: input.attempt,
    finalization: { collector: input.collector },
    stimuli: { state: input.stimuli === null ? 'none' : 'selected', activities: stimuli },
  } as const;
  const reasons = [...attemptReasons(input.attempt), ...collectorReasons(input.collector)];
  const empty = {
    payloadCount: 0,
    diagnostics: [],
    missingActivityTraces: [],
    observedServices: [],
    activatedWithoutObservation: [],
  };
  const unobserved = (state: ObservationState, message: string): FinalSnapshotDocument => ({
    ...base,
    observation: { state, message, ...empty },
    completeness: {
      status: 'unavailable',
      closed: false,
      attestation: 'none',
      finalizationImpliesCompleteness: false,
      reasons: sorted([...reasons, `observation-${state}`]),
    },
    evidence: { kind: 'not-admitted' },
  });
  if (input.read === null) {
    return unobserved(
      'no-stimulus',
      'No stimulus activity completed, so no activity was selected to read.',
    );
  }
  if (input.read.kind !== 'admitted') {
    return unobserved(input.read.kind, input.read.message);
  }
  const projected = graphOf(input.read);
  if (projected.kind === 'rejected') {
    return unobserved('projection-rejected', projected.message);
  }
  const { graph } = projected;
  const observed = sorted(graph.effects.map((effect) => effect.actor));
  const activated = input.collector.state === 'found' ? input.collector.activatedServices : [];
  const silent = sorted(activated.filter((service) => !observed.includes(service)));
  const missing = input.read.diagnostics.filter((entry) =>
    entry.startsWith('activity-trace-not-received:'),
  );
  return {
    ...base,
    observation: {
      state: 'admitted',
      message: '',
      payloadCount: input.read.payloads.length,
      diagnostics: input.read.diagnostics,
      missingActivityTraces: missing,
      observedServices: observed,
      activatedWithoutObservation: silent,
    },
    completeness: {
      status: 'not-demonstrated',
      closed: false,
      attestation: 'none',
      finalizationImpliesCompleteness: false,
      reasons: sorted([
        ...reasons,
        ...graph.quality.reasons,
        ...(missing.length > 0 ? ['activity-trace-not-received'] : []),
        ...silent.map((service) => `activated-without-observation:${service}`),
      ]),
    },
    evidence: createEffectSnapshotArtifact({ read: input.read, graph }),
  };
}
