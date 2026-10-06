import type { CollectorSnapshotReadResult } from '@suites/blackbox-otel-collector';

import type { OwnedActivity } from './types.js';

export const identity = { sessionId: 'scope-session', executionId: 'scope-execution' };

export function span(activity: OwnedActivity, spanId = '1111111111111111') {
  return {
    traceId: activity.context.traceId,
    spanId,
    name: 'POST /orders',
    kind: 2,
    parentSpanId: activity.context.spanId,
    attributes: [{ key: 'http.request.method', value: { stringValue: 'POST' } }],
  };
}

export function payload(spans: readonly unknown[]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'api' } }] },
        scopeSpans: [{ scope: { name: 'real-child-instrumentation' }, spans }],
      },
    ],
  };
}

export function snapshot(
  traces: readonly { readonly traceId: string; readonly payload: unknown }[],
): Extract<CollectorSnapshotReadResult, { kind: 'collector-snapshot-found' }> {
  return {
    kind: 'collector-snapshot-found',
    identity,
    lifecycle: {
      ...identity,
      schemaVersion: 1,
      revision: 1,
      runs: [],
      telemetry: {
        status: 'received',
        acceptedRequests: traces.length,
        acceptedSpans: traces.length,
        lastReceivedAt: '2026-10-03T00:00:00Z',
      },
    },
    fragments: [],
    traces: traces.map((trace, index) => ({
      traceId: trace.traceId,
      fragments: [
        { sequence: index + 1, receivedAt: '2026-10-03T00:00:00Z', request: trace.payload },
      ],
    })),
  };
}
