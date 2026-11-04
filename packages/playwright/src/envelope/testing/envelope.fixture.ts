import { createActivityRegistry } from '../../activities/activity-registry.js';
import { identity, payload, snapshot, span } from '../../activities/observations.fixture.js';
import { admitSnapshot } from '../../activities/scoped-observations.js';
import {
  buildFinalSnapshot,
  type CollectorFinalization,
  type FinalSnapshotDocument,
} from '../../effects/final-snapshot.js';
import { buildEnvelope, type BuildEnvelopeInput } from '../build.js';
import { digestBytes } from '../canonical.js';
import {
  captureConfiguration,
  catalogConfiguration,
  configurationSection,
  environmentConfiguration,
  instrumentationConfiguration,
  sourceFingerprint,
} from '../fingerprints.js';
import { stimulusFingerprint, type RecordedRequest } from '../../stimulus/summary.js';
import type { EvidenceRef, SourceSection, StimulusSection, WorkingTree } from '../types.js';

export const collector = {
  state: 'found',
  receiver: 'stopped',
  shutdown: 'complete',
  acceptedRequests: 3,
  acceptedSpans: 4,
  activatedServices: ['api', 'worker'],
  failure: null,
} satisfies CollectorFinalization;

/** A final snapshot whose only observed service is `api`. */
export function snapshotFixture(
  overrides: Partial<{ collector: CollectorFinalization; status: string }> = {},
): FinalSnapshotDocument {
  const registry = createActivityRegistry(identity);
  const stimulus = registry.begin({ purpose: 'stimulus', name: 'create' });
  const selection = registry.select({ kind: 'stimulus', activities: [stimulus] });
  const read = admitSnapshot(
    snapshot([{ traceId: stimulus.context.traceId, payload: payload([span(stimulus)]) }]),
    selection,
  );
  return buildFinalSnapshot({
    attempt: {
      testId: 'runner-id',
      retry: 0,
      status: overrides.status ?? 'passed',
      expectedStatus: 'passed',
      errorCount: 0,
      stopReason: 'completed',
    },
    collector: overrides.collector ?? collector,
    stimuli: [{ activityId: 'a-1', purpose: 'stimulus' }],
    read,
  });
}

export function configurationFixture(
  overrides: Partial<{ compose: string; activation: string; node: string; flag: string }> = {},
) {
  return configurationSection({
    catalog: catalogConfiguration({
      entryId: 'system',
      resolved: { services: ['api', 'worker', 'db'] },
      inputs: [
        {
          role: 'compose',
          path: 'compose.yml',
          state: 'present',
          digest: digestBytes(overrides.compose ?? 'compose-v1'),
        },
      ],
    }),
    instrumentation: instrumentationConfiguration({
      activations: [{ id: 'node', adapter: 'node-preload', version: 1 }],
      inputs: [
        {
          role: 'activation',
          path: 'instrumentation.js',
          state: 'present',
          digest: digestBytes(overrides.activation ?? 'activation-v1'),
        },
      ],
    }),
    capture: captureConfiguration({
      collector: {
        image: 'collector@sha256:aaa',
        limits: { BLACKBOX_OTEL_MAX_REQUEST_BYTES: '16' },
      },
      snapshot: { schemaVersion: 1, selection: 'completed-stimulus-activities' },
      noiseProfile: 'infrastructure-1',
      schemas: { effectsGraph: '0.1.1', effectsRecord: 0 },
      admission: { selectedTraces: 8 },
      evidenceLimits: { effects: 128 },
      state: 'captured',
    }),
    environment: environmentConfiguration({
      platform: 'linux',
      arch: 'x64',
      node: overrides.node ?? 'v22.0.0',
      docker: '28.0.0',
      playwright: '1.64.0',
      workers: 1,
      project: 'default',
      variables: { FEATURE_FLAG: overrides.flag ?? 'on', API_TOKEN: 'secret-value-1' },
    }),
  });
}

const snapshotRef = {
  id: digestBytes('snapshot-body'),
  kind: 'final-snapshot',
  bytes: 13,
  locator: { type: 'attachment', name: 'blackbox-effects-final', sequence: 1 },
} satisfies EvidenceRef;

export function inputFixture(overrides: Partial<BuildEnvelopeInput> = {}): BuildEnvelopeInput {
  return {
    behavior: {
      id: 'derived:abc',
      basis: 'derived',
      derivedId: 'derived:abc',
      declaration: { state: 'absent' },
    },
    attempt: {
      attemptId: 'attempt-1',
      executionId: 'attempt-1',
      sessionId: 'session-1',
      retry: 0,
      retries: 1,
    },
    system: {
      catalogEntry: { id: 'system', kind: 'system' },
      participants: [
        {
          id: 'api',
          service: 'api',
          role: 'entrypoint',
          runtime: 'node',
          instrumentation: 'configured',
          activationId: 'node',
        },
        {
          id: 'worker',
          service: 'worker',
          role: 'application',
          runtime: 'node',
          instrumentation: 'configured',
          activationId: 'node',
        },
        {
          id: 'db',
          service: 'db',
          role: 'dependency',
          runtime: 'infra',
          instrumentation: 'unconfigured',
          activationId: null,
        },
      ],
      observationPolicy: { policyId: 'policy', requiredBoundaries: ['effects.http'] },
    },
    source: sourceFixture({ commit: 'c1', workingTree: { state: 'clean' } }),
    configuration: configurationFixture(),
    snapshot: snapshotFixture(),
    snapshotEvidence: snapshotRef,
    stimulus: stimulusFixture(),
    state: { records: [], rejected: 0 },
    evidence: [snapshotRef],
    assertions: [],
    testStatus: { status: 'passed', expectedStatus: 'passed', errorCount: 0 },
    provenance: {
      capturedAt: '2026-01-01T00:00:00.000Z',
      test: {
        file: 'a.spec.ts',
        titlePath: ['suite', 'case'],
        project: 'default',
        runnerTestId: 'runner-id',
      },
      source: { branch: 'main', changedPaths: [] },
      ci: {},
      packageVersion: '0.0.1',
    },
    ...overrides,
  };
}

export function envelopeFixture(overrides: Partial<BuildEnvelopeInput> = {}) {
  return buildEnvelope(inputFixture(overrides));
}

export function sourceFixtureAt(input: {
  commit: string;
  tree: string;
  workingTree: WorkingTree;
}): SourceSection {
  const identity = {
    repoId: 'git:root',
    commit: input.commit,
    tree: input.tree,
    workingTree: input.workingTree,
  };
  return { state: 'captured', ...identity, fingerprint: sourceFingerprint(identity), reason: null };
}

export function sourceFixture(input: { commit: string; workingTree: WorkingTree }): SourceSection {
  return sourceFixtureAt({ ...input, tree: `tree-${input.commit}` });
}

export function requestFixture(overrides: Partial<RecordedRequest> = {}): RecordedRequest {
  return {
    method: 'POST',
    target: 'entrypoint',
    origin: null,
    path: '/subscriptions',
    query: null,
    body: digestBytes('body-alice'),
    contentType: 'application/json',
    headers: {},
    ...overrides,
  };
}

export function stimulusFixture(
  requests: readonly RecordedRequest[] = [requestFixture()],
): StimulusSection {
  const activities = [{ title: 'When Alice subscribes', requests }];
  return {
    state: 'recorded',
    activities,
    unscopedRequests: 0,
    opaqueRequests: 0,
    fingerprint: stimulusFingerprint(activities, 0),
  };
}
