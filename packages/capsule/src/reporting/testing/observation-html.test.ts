import { expect, it } from 'vitest';

import { renderCapsuleHtml } from '../../index.js';
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
    activities: [],
    activityTelemetry: [],
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
        sessionOnly: ['99999999999999999999999999999999'],
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
  expect(html).toContain('instrumentation not activated');
  expect(html).toContain('"shutdown":"interrupted"');
  expect(html).toContain('CollectorInterrupted');
});
