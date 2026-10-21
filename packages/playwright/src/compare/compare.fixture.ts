import { buildEnvelope, type BuildEnvelopeInput } from '../envelope/build.js';
import { digestBytes } from '../envelope/canonical.js';
import {
  sourceFixtureAt,
  configurationFixture,
  inputFixture,
  requestFixture,
  stimulusFixture,
} from '../envelope/envelope.fixture.js';
import { stateSection } from '../envelope/state.js';
import type { BehaviorEnvelope, BehaviorIdentity, EvidenceRef } from '../envelope/types.js';
import { loadSide } from './side.js';
import { snapshotWith, span, type SpanSpec } from './snapshot.fixture.js';
import type { ComparisonSide } from './types.js';

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
  readonly capturedAt: string;
  readonly commit: string;
  readonly tree: string | null;
  readonly invocation: string | null;
  readonly assertions: readonly { readonly outcome: string; readonly evaluation: string }[];
}

function assertionFixtures(attemptId: string, assertions: SideSpec['assertions']) {
  return assertions.map((assertion, index) => {
    const body = `assertion-${attemptId}-${String(index)}`;
    return {
      result: {
        sequence: index + 1,
        outcome: assertion.outcome,
        evaluation: assertion.evaluation,
        contractDigest: digestBytes('contract'),
        evidence: digestBytes(body),
      },
      ref: {
        id: digestBytes(body),
        kind: 'assertion-evidence',
        bytes: body.length,
        locator: { type: 'attachment', name: 'blackbox-effects', sequence: index + 1 },
      } satisfies EvidenceRef,
    };
  });
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
    capturedAt: '2026-01-01T00:00:00.000Z',
    commit: 'c1',
    tree: null,
    invocation: null,
    assertions: [],
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
  const assertionEvidence = assertionFixtures(spec.attemptId, spec.assertions);
  const envelope = buildEnvelope({
    ...base,
    behavior: spec.behavior,
    attempt: { ...base.attempt, attemptId, executionId: attemptId, retry: spec.retry },
    system: spec.system,
    source: sourceFixtureAt({
      commit: spec.commit,
      tree: spec.tree ?? `tree-${spec.commit}`,
      workingTree: { state: 'clean' },
    }),
    provenance: {
      ...base.provenance,
      capturedAt: spec.capturedAt,
      ci: spec.invocation === null ? {} : { invocation: spec.invocation },
    },
    configuration: spec.configuration,
    snapshot,
    snapshotEvidence: ref,
    evidence: [ref, ...assertionEvidence.map(({ ref: evidence }) => evidence)],
    assertions: assertionEvidence.map(({ result }) => result),
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

export { span, snapshotWith };
export type { SpanSpec };
