import {
  CAUSED_TRACE,
  UNLINKED_TRACE,
  activity,
  report,
  session,
  traces,
} from './causality.fixture.js';

/** An activity with one caused trace and a worker trace that merely overlaps its time window. */
export const server = {
  traceId: CAUSED_TRACE,
  spanId: 'a000000000000001',
  parentSpanId: 'cccccccccccccccc',
  name: 'POST',
  service: 'orders-api',
  start: '2026-09-24T10:00:10.500Z',
  attributes: [
    ['http.request.method', 'POST'],
    ['http.route', '/orders'],
  ],
} as const;
export const child = {
  traceId: CAUSED_TRACE,
  spanId: 'a000000000000002',
  parentSpanId: 'a000000000000001',
  name: 'insert',
  service: 'orders-api',
  kind: 3,
  start: '2026-09-24T10:00:10.600Z',
  attributes: [
    ['db.operation.name', 'insert'],
    ['db.collection.name', 'orders'],
  ],
} as const;
// Starts inside the activity's time window but carries no trace context from it.
export const unlinked = {
  traceId: UNLINKED_TRACE,
  spanId: 'b000000000000001',
  name: 'consume',
  service: 'worker',
  kind: 5,
  start: '2026-09-24T10:00:11.000Z',
  attributes: [
    ['messaging.operation.type', 'process'],
    ['messaging.destination.name', 'orders'],
  ],
} as const;

export const stimulus = activity({
  activityId: 'c0ffee00-0000-4000-8000-000000000001',
  sequence: 1,
  traceId: CAUSED_TRACE,
  propagation: 'sent',
});

export function overlapping() {
  return report({
    activities: [stimulus],
    observations: session([CAUSED_TRACE, UNLINKED_TRACE]),
    traceObservations: traces([server, child, unlinked]),
  });
}
