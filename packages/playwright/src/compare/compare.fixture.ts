import type {
  EffectOwnershipExcerpt,
  ObservationExcerpt,
  ProjectedEffectExcerpt,
} from '../effects/evaluation/artifact-types.js';
import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import { buildEnvelope, type BuildEnvelopeInput } from '../envelope/build.js';
import { digestBytes } from '../envelope/canonical.js';
import {
  configurationFixture,
  inputFixture,
  requestFixture,
  stimulusFixture,
} from '../envelope/envelope.fixture.js';
import { stateSection } from '../envelope/state.js';
import type { BehaviorEnvelope, BehaviorIdentity, EvidenceRef } from '../envelope/types.js';
import { loadSide } from './side.js';
import type { ComparisonSide } from './types.js';

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
export function snapshotWith(
  specs: readonly SpanSpec[],
  options: { readonly activated: readonly string[] | null; readonly status: string } = {
    activated: null,
    status: 'passed',
  },
): FinalSnapshotDocument {
  const { effects, excerpts, ownership } = spansOf(specs);
  const actors = [...new Set(specs.map(({ actor }) => actor))].sort();
  return {
    schemaVersion: 1,
    kind: 'final-snapshot',
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
      omitted: noneOmitted,
    },
  };
}

export interface SideSpec {
  readonly spans: readonly SpanSpec[];
  readonly activated: readonly string[] | null;
  readonly attemptId: string;
  readonly retry: number;
  readonly status: string;
  readonly behavior: BehaviorIdentity;
  readonly stimulus: BuildEnvelopeInput['stimulus'];
  readonly configuration: BuildEnvelopeInput['configuration'];
  readonly state: readonly { subject: string; identities: readonly string[] }[];
  readonly system: BuildEnvelopeInput['system'];
}

/** Participants of the fixture system: api and worker are instrumented, db is not. */
export function rawSide(overrides: Partial<SideSpec>): {
  readonly envelope: BehaviorEnvelope;
  readonly body: string;
} {
  const base = inputFixture();
  const spec = {
    spans: [],
    activated: null,
    attemptId: 'attempt-1',
    retry: 0,
    status: 'passed',
    behavior: base.behavior,
    stimulus: stimulusFixture(),
    configuration: base.configuration,
    state: [],
    system: base.system,
    ...overrides,
  } satisfies SideSpec;
  const snapshot = snapshotWith(spec.spans, { activated: spec.activated, status: spec.status });
  const body = JSON.stringify(snapshot);
  const ref = {
    id: digestBytes(body),
    kind: 'final-snapshot',
    bytes: body.length,
    locator: { type: 'attachment', name: 'blackbox-effects-final', sequence: 1 },
  } satisfies EvidenceRef;
  const attemptId = spec.attemptId;
  const envelope = buildEnvelope({
    ...base,
    behavior: spec.behavior,
    attempt: { ...base.attempt, attemptId, executionId: attemptId, retry: spec.retry },
    system: spec.system,
    configuration: spec.configuration,
    snapshot,
    snapshotEvidence: ref,
    evidence: [ref],
    stimulus: spec.stimulus,
    state: stateSection(
      spec.state.map((record) => ({
        type: 'bb:state',
        description: JSON.stringify({
          subject: record.subject,
          source: 'fixture',
          identities: record.identities,
        }),
      })),
    ),
    testStatus: { status: spec.status, expectedStatus: 'passed', errorCount: 0 },
  });
  return { envelope, body };
}

export function sideFixture(overrides: Partial<SideSpec>): ComparisonSide {
  const { envelope, body } = rawSide(overrides);
  const loaded = loadSide({ envelope, snapshotBody: body });
  if (loaded.kind !== 'loaded') {
    throw new Error(`fixture side rejected: ${loaded.problems.join(', ')}`);
  }
  return loaded.side;
}

export const healthy = [
  span({ actor: 'api' }),
  span({ actor: 'api', side: '3', spans: 2 }),
  span({ actor: 'worker', kind: 'rpc', operation: 'SendMessage' }),
] satisfies readonly SpanSpec[];

export { configurationFixture, requestFixture, stimulusFixture };
