import type { CapsuleReportDocument } from '../reporting/types.js';
import { completedDriverActivity } from '../persistence/testing/record.fixture.js';

/** A valid stopped-capsule report, as the operational report schema describes it. */
export function report(): CapsuleReportDocument {
  return {
    schemaVersion: 1,
    kind: 'capsule-operational-report',
    generatedAt: '2026-09-23T12:02:00.000Z',
    session: {
      sessionId: 'quiet-river-ada',
      system: 'orders',
      title: 'Orders exploration',
      description: { kind: 'omitted' },
      retainedState: 'stopped',
      admittedAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:03.000Z',
      artifactRoot: '[REDACTED]',
    },
    lifecycle: { kind: 'stopped', retainedState: 'stopped' },
    observationPolicy: { kind: 'not-recorded' },
    composeProject: { kind: 'available', value: 'orders' },
    entrypoint: { kind: 'unavailable' },
    resources: { containers: [], networks: [], volumes: [] },
    readiness: { kind: 'unavailable' },
    activities: [completedDriverActivity()],
    activityTelemetry: [],
    progress: [],
    observations: {
      kind: 'collector-session-found',
      telemetry: {
        status: 'received',
        acceptedRequests: 1,
        acceptedSpans: 2,
        lastReceivedAt: '2026-09-24T00:00:02.000Z',
      },
      fragmentCount: 1,
      runs: [
        {
          startedAt: '2026-09-24T00:00:00.000Z',
          updatedAt: '2026-09-24T00:00:03.000Z',
          stopped: { kind: 'stopped', at: '2026-09-24T00:00:03.000Z' },
          receiver: 'stopped',
          instrumentation: {
            kind: 'activated',
            activations: [
              {
                kind: 'instrumentation-activation',
                runtime: 'node',
                serviceName: 'orders-api',
                activatedAt: '2026-09-24T00:00:01.000Z',
              },
            ],
          },
          shutdown: 'complete',
          failure: { kind: 'none' },
        },
      ],
      traces: {
        activityCorrelated: [],
        sessionOnly: [
          {
            kind: 'unavailable',
            traceId: 'trace-1',
            association: { kind: 'session-only' },
            reason: 'not-retained',
          },
        ],
      },
    },
    cleanup: { kind: 'complete' },
    failure: { kind: 'none' },
    redactions: { count: 0, entries: [] },
  };
}
