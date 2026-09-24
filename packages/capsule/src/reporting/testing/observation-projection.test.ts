import type { CollectorSessionReadResult } from '@suites/blackbox-otel-collector-internal';
import { expect, it } from 'vitest';

import type { CapsuleSessionRecord } from '../../records.js';
import { projectCapsuleReport } from '../document.js';

const sessionId = 'quiet-river-ada';
const executionId = '00000000-0000-4000-8000-000000000001';
const record = {
  schemaVersion: 1,
  sessionId,
  executionId,
  system: 'orders',
  title: 'Orders experiment',
  description: { kind: 'omitted' },
  state: 'stopped',
  revision: 1,
  admittedAt: '2026-09-24T10:00:00.000Z',
  updatedAt: '2026-09-24T10:01:00.000Z',
  manager: { kind: 'not-started' },
  socketPath: '/private/manager.sock',
  entrypoint: { kind: 'unavailable' },
  containers: [],
  cleanup: { kind: 'complete' },
  failure: { kind: 'none' },
  composeProject: { kind: 'unavailable' },
  artifactRoot: '/private/artifacts',
  networks: [],
  volumes: [],
  readiness: { kind: 'unavailable' },
} satisfies CapsuleSessionRecord;

function project(observations: CollectorSessionReadResult) {
  return projectCapsuleReport({
    record,
    activities: [],
    progress: [],
    activityObservations: [],
    observations,
  });
}

it('projects factual collector counts and trace identities without an assurance conclusion', () => {
  const observations = {
    kind: 'collector-session-found',
    lifecycle: {
      schemaVersion: 1,
      sessionId,
      executionId,
      revision: 3,
      runs: [
        {
          instanceId: 'collector-1',
          startedAt: '2026-09-24T10:00:00.000Z',
          updatedAt: '2026-09-24T10:01:00.000Z',
          stoppedAt: '2026-09-24T10:01:00.000Z',
          receiver: 'stopped',
          instrumentation: { kind: 'not-activated' },
          shutdown: 'complete',
          failure: null,
          endpoint: {
            kind: 'http',
            host: '127.0.0.1',
            port: 4318,
            baseUrl: 'http://127.0.0.1:4318',
            tracesPath: '/v1/traces',
            tracesUrl: 'http://127.0.0.1:4318/v1/traces',
            activationPath: '/v1/activation',
            activationUrl: 'http://127.0.0.1:4318/v1/activation',
            readinessPath: '/ready',
            readinessUrl: 'http://127.0.0.1:4318/ready',
            readPath: '/v1/collector',
            readUrl: 'http://127.0.0.1:4318/v1/collector',
          },
        },
      ],
      telemetry: {
        status: 'received',
        acceptedRequests: 2,
        acceptedSpans: 3,
        lastReceivedAt: '2026-09-24T10:00:30.000Z',
      },
    },
    fragments: [
      { sequence: 1, receivedAt: '2026-09-24T10:00:20.000Z', spanCount: 2 },
      { sequence: 2, receivedAt: '2026-09-24T10:00:30.000Z', spanCount: 1 },
    ],
    traceIds: ['11111111111111111111111111111111'],
  } satisfies CollectorSessionReadResult;
  const projected = project(observations).observations;
  expect(projected).toEqual({
    kind: 'collector-session-found',
    telemetry: observations.lifecycle.telemetry,
    fragmentCount: 2,
    traceIds: ['11111111111111111111111111111111'],
    activations: [],
  });
  expect(JSON.stringify(projected)).not.toMatch(/executionId|instanceId|endpoint/u);
});

it.each([
  {
    kind: 'collector-session-missing',
    identity: { sessionId, executionId },
    message: 'No retained collector session exists for the exact identity.',
  },
  {
    kind: 'collector-session-corrupt',
    identity: { sessionId, executionId },
    error: { name: 'SyntaxError', message: 'retained lifecycle is corrupt' },
  },
] satisfies readonly CollectorSessionReadResult[])(
  'preserves $kind as an explicit report limitation',
  (observations) => {
    const projected = project(observations).observations;
    expect(projected).toMatchObject(
      observations.kind === 'collector-session-missing'
        ? { kind: observations.kind, message: observations.message }
        : { kind: observations.kind, error: observations.error },
    );
    expect(projected).not.toHaveProperty('identity');
  },
);
