import { expect, it } from 'vitest';

import { renderCapsuleHtml } from '../../index.js';
import { completedHostActivity } from '../../persistence/testing/record.fixture.js';
import type { CapsuleReportDocument } from '../types.js';

function report(): CapsuleReportDocument {
  return {
    schemaVersion: 1,
    kind: 'capsule-operational-report',
    session: {
      sessionId: 'bright-river-ada',
      system: 'orders',
      title: 'Orders demo',
      description: { kind: 'omitted' },
      retainedState: 'stopped',
      admittedAt: '2026-09-23T12:00:00.000Z',
      updatedAt: '2026-09-23T12:01:00.000Z',
      artifactRoot: '[REDACTED]',
    },
    lifecycle: { kind: 'stopped', retainedState: 'stopped' },
    composeProject: { kind: 'unavailable' },
    entrypoint: { kind: 'unavailable' },
    readiness: { kind: 'unavailable' },
    resources: { containers: [], networks: [], volumes: [] },
    activities: [completedHostActivity()],
    activityTelemetry: [{ kind: 'unavailable', activityId: 'activity-1', reason: 'not-retained' }],
    progress: [],
    observations: {
      kind: 'collector-session-found',
      telemetry: {
        status: 'received',
        acceptedRequests: 1,
        acceptedSpans: 2,
        lastReceivedAt: '2026-09-23T12:00:30.000Z',
      },
      fragmentCount: 1,
      runs: [
        {
          startedAt: '2026-09-23T12:00:00.000Z',
          updatedAt: '2026-09-23T12:01:00.000Z',
          stopped: { kind: 'not-stopped' },
          receiver: 'interrupted',
          instrumentation: { kind: 'not-activated' },
          shutdown: 'interrupted',
          failure: {
            kind: 'recorded',
            error: { name: 'CollectorInterrupted', message: 'connection closed' },
          },
        },
      ],
      traces: {
        activityCorrelated: [],
        sessionOnly: [
          {
            kind: 'available',
            traceId: '99999999999999999999999999999999',
            association: { kind: 'activity-window', activityId: 'activity-1' },
            spans: [
              {
                traceId: '99999999999999999999999999999999',
                spanId: 'aaaaaaaaaaaaaaaa',
                parentSpanId: null,
                spanKind: 'consumer',
                operation: 'consume redis job',
                service: 'redis-proof-consumer',
                startTimeUnixNano: '1789819200500000000',
                endTimeUnixNano: '1789819200600000000',
                statusCode: 1,
                attributes: [],
                links: [],
              },
            ],
          },
        ],
      },
    },
    cleanup: { kind: 'complete' },
    failure: { kind: 'none' },
    redactions: { count: 0, entries: [] },
  };
}

it('labels session-only traces and exposes capture lifecycle failures', () => {
  const html = renderCapsuleHtml({ report: report() });
  expect(html).toContain('Session-only traces have no exact activity correlation.');
  expect(html).toContain('No causal relationship is claimed.');
  expect(html).toContain('Observed after this activity');
  expect(html).toContain('temporal only');
  expect(html).toContain('Session observations');
  expect(html).toContain('consume redis job');
  expect(html).toContain('redis-proof-consumer');
  expect(html).toContain('instrumentation not activated');
  expect(html).toContain('"shutdown":"interrupted"');
  expect(html).toContain('CollectorInterrupted');
});
