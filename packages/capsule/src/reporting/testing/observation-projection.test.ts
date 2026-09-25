import type {
  CollectorSessionReadResult,
  CollectorTracesReadResult,
} from '@suites/blackbox-otel-collector-internal';
import { expect, it } from 'vitest';

import type { CapsuleSessionRecord } from '../../records.js';
import { completedHostActivity } from '../../persistence/testing/record.fixture.js';
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
  const traceObservations = {
    kind: 'collector-traces-found',
    identity: { sessionId, executionId },
    traces: [
      {
        traceId: '99999999999999999999999999999999',
        fragments: [
          {
            sequence: 2,
            receivedAt: '2026-09-23T12:00:00.500Z',
            request: {
              resourceSpans: [
                {
                  resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: 'worker' } }],
                  },
                  scopeSpans: [
                    {
                      spans: [
                        {
                          traceId: '99999999999999999999999999999999',
                          spanId: 'aaaaaaaaaaaaaaaa',
                          name: 'consume job',
                          startTimeUnixNano: String(
                            BigInt(Date.parse('2026-09-23T12:00:00.500Z')) * 1_000_000n,
                          ),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  } satisfies CollectorTracesReadResult;
  return projectCapsuleReport({
    record,
    activities: [completedHostActivity()],
    progress: [],
    activityObservations: [],
    observations,
    traceObservations,
  });
}

function found(): Extract<
  CollectorSessionReadResult,
  { readonly kind: 'collector-session-found' }
> {
  return {
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
          receiver: 'interrupted',
          instrumentation: { kind: 'not-activated' },
          shutdown: 'interrupted',
          failure: { name: 'CollectorInterrupted', message: 'collector connection closed' },
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
    traceIds: ['11111111111111111111111111111111', '99999999999999999999999999999999'],
  };
}

it('projects factual collector counts and trace identities without an assurance conclusion', () => {
  const observations = found();
  const projected = project(observations).observations;
  expect(projected).toEqual({
    kind: 'collector-session-found',
    telemetry: observations.lifecycle.telemetry,
    fragmentCount: 2,
    runs: [
      {
        startedAt: '2026-09-24T10:00:00.000Z',
        updatedAt: '2026-09-24T10:01:00.000Z',
        stopped: { kind: 'stopped', at: '2026-09-24T10:01:00.000Z' },
        receiver: 'interrupted',
        instrumentation: { kind: 'not-activated' },
        shutdown: 'interrupted',
        failure: {
          kind: 'recorded',
          error: {
            name: 'CollectorInterrupted',
            message: 'collector connection closed',
          },
        },
      },
    ],
    traces: {
      activityCorrelated: [
        {
          traceId: '11111111111111111111111111111111',
          activityIds: ['activity-1'],
        },
      ],
      sessionOnly: [
        {
          kind: 'available',
          traceId: '99999999999999999999999999999999',
          association: { kind: 'activity-window', activityId: 'activity-1' },
          spans: [
            expect.objectContaining({
              service: 'worker',
              operation: 'consume job',
            }),
          ],
        },
      ],
    },
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
