import type {
  EffectOwnershipExcerpt,
  ObservationExcerpt,
  ProjectedEffectExcerpt,
} from '../../effects/evaluation/artifact-types.js';
import type { FinalSnapshotDocument } from '../../effects/final-snapshot.js';

export interface SpanSpec {
  readonly kind: string;
  readonly actor: string;
  /** OTLP span kind: 2 server, 3 client, 4 producer. */
  readonly side: string;
  readonly operation: string;
  readonly target: string;
  readonly outcome: string;
  readonly infrastructure: 'connection-pool' | 'connection-establishment' | null;
  /** How many distinct spans of this shape. */
  readonly spans: number;
}

export function span(overrides: Partial<SpanSpec> & { readonly actor: string }): SpanSpec {
  return {
    kind: 'http',
    side: '2',
    operation: 'POST',
    target: 'unknown',
    outcome: 'unknown',
    infrastructure: null,
    spans: 1,
    ...overrides,
  };
}

let serial = 0;

function id(prefix: string): string {
  serial += 1;
  return `${prefix}${serial.toString(16).padStart(16 - prefix.length, '0')}`;
}

const noneOmitted = {
  activities: 0,
  activityTraces: 0,
  diagnostics: 0,
  observations: 0,
  effects: 0,
  effectSources: 0,
  relations: 0,
  qualityReasons: 0,
  ownership: 0,
  owners: 0,
};

function spansOf(specs: readonly SpanSpec[]): {
  readonly effects: ProjectedEffectExcerpt[];
  readonly excerpts: ObservationExcerpt[];
  readonly ownership: EffectOwnershipExcerpt[];
} {
  const traceId = 'a'.repeat(32);
  const effects: ProjectedEffectExcerpt[] = [];
  const excerpts: ObservationExcerpt[] = [];
  const ownership: EffectOwnershipExcerpt[] = [];
  for (const spec of specs) {
    for (let index = 0; index < spec.spans; index += 1) {
      const spanId = id('b');
      const effectId = `${traceId}:${spanId}`;
      effects.push({
        id: effectId,
        kind: spec.kind,
        operation: spec.operation,
        target: spec.target,
        actor: spec.actor,
        outcome: spec.outcome,
        source: [{ traceId, spanId }],
      });
      excerpts.push({
        traceId,
        spanId,
        service: spec.actor,
        kind: spec.side,
        status: '0',
        infrastructure: spec.infrastructure,
        fields: [],
      });
      ownership.push({
        effectId,
        observations: [{ traceId, spanId, owners: [{ activityId: 'a-1', purpose: 'stimulus' }] }],
      });
    }
  }
  return { effects, excerpts, ownership };
}

/** A final snapshot built to the shape the real one has, with one span identity per counted span. */
export interface SnapshotOptions {
  readonly activated: readonly string[] | null;
  readonly status: string;
  /** Effects the snapshot's retention limit cut off. */
  readonly omittedEffects: number;
  /** Strings the attachment cut at its display limit. */
  readonly truncatedStrings: number;
}

const defaultSnapshotOptions = {
  activated: null,
  status: 'passed',
  omittedEffects: 0,
  truncatedStrings: 0,
} satisfies SnapshotOptions;

export function snapshotWith(
  specs: readonly SpanSpec[],
  options: SnapshotOptions = defaultSnapshotOptions,
): FinalSnapshotDocument {
  const { effects, excerpts, ownership } = spansOf(specs);
  const actors = [...new Set(specs.map(({ actor }) => actor))].sort();
  return {
    schemaVersion: 1,
    kind: 'final-snapshot',
    ...(options.truncatedStrings > 0
      ? { display: { stringLimit: 1000, truncatedStrings: options.truncatedStrings } }
      : {}),
    attempt: {
      testId: 'runner-id',
      retry: 0,
      status: options.status,
      expectedStatus: 'passed',
      errorCount: 0,
      stopReason: 'completed',
    },
    finalization: {
      collector: {
        state: 'found',
        receiver: 'stopped',
        shutdown: 'complete',
        acceptedRequests: 1,
        acceptedSpans: effects.length,
        activatedServices: options.activated ?? actors,
        failure: null,
      },
    },
    stimuli: { state: 'selected', activities: [{ activityId: 'a-1', purpose: 'stimulus' }] },
    observation: {
      state: 'admitted',
      message: '',
      payloadCount: 1,
      diagnostics: [],
      missingActivityTraces: [],
      observedServices: actors,
      activatedWithoutObservation: [],
    },
    completeness: {
      status: 'not-demonstrated',
      closed: false,
      attestation: 'none',
      finalizationImpliesCompleteness: false,
      reasons: ['no-harness-completeness-attestation'],
    },
    evidence: {
      kind: 'admitted',
      observations: { scopeId: 'scope', payloadCount: 1, diagnostics: [], excerpts },
      selection: {
        scopeId: 'scope',
        sessionId: 's',
        executionId: 'e',
        kind: 'stimulus',
        activities: [],
      },
      projection: {
        schemaVersion: '0.1.1',
        scope: { id: 'scope', closed: false },
        quality: {
          coverage: 'partial',
          orderCoverage: 'unknown',
          reasons: [],
          attestation: 'none',
        },
        effects,
        relations: [],
      },
      ownership,
      omitted: { ...noneOmitted, effects: options.omittedEffects },
    },
  };
}
