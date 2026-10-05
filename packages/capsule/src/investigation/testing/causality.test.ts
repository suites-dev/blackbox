import { expect, it } from 'vitest';

import { completedHostActivity } from '../../persistence/testing/record.fixture.js';
import { createRedactionContext } from '../../reporting/redaction.js';
import { projectObservations } from '../../reporting/observations.js';
import {
  ACTIVITY_WINDOW_GRACE_MS,
  activityWindowEndMs,
  earliestStart,
  placeTraces,
  type CausalityActivity,
} from '../causality.js';

const ns = (iso: string) => String(BigInt(Date.parse(iso)) * 1_000_000n);

const first = {
  activityId: 'act-1',
  sequence: 1,
  traceId: '1'.repeat(32),
  startedAt: '2026-09-01T10:00:10.000Z',
} satisfies CausalityActivity;
const second = {
  activityId: 'act-2',
  sequence: 2,
  traceId: '2'.repeat(32),
  startedAt: '2026-09-01T10:00:20.000Z',
} satisfies CausalityActivity;

it('links a trace to an activity only by exact trace ID', () => {
  const placements = placeTraces({
    activities: [first, second],
    traces: [
      { traceId: '2'.repeat(32), earliestStartUnixNano: ns('2026-09-01T10:00:11.000Z') },
      // One character off, and inside act-1's time: still no cause.
      { traceId: `${'1'.repeat(31)}0`, earliestStartUnixNano: ns('2026-09-01T10:00:10.001Z') },
    ],
  });
  expect(placements).toEqual([
    { kind: 'caused', traceId: '2'.repeat(32), activityId: 'act-2' },
    {
      kind: 'uncaused',
      traceId: `${'1'.repeat(31)}0`,
      placedAfter: 'act-1',
      earliestStartUnixNano: ns('2026-09-01T10:00:10.001Z'),
    },
  ]);
});

it('places uncaused traces before, between and after activities, in start order', () => {
  const placements = placeTraces({
    activities: [second, first],
    traces: [
      { traceId: 'c'.repeat(32), earliestStartUnixNano: ns('2026-09-01T10:00:30.000Z') },
      { traceId: 'a'.repeat(32), earliestStartUnixNano: ns('2026-09-01T10:00:01.000Z') },
      { traceId: 'b'.repeat(32), earliestStartUnixNano: ns('2026-09-01T10:00:15.000Z') },
      { traceId: 'e'.repeat(32), earliestStartUnixNano: ns('2026-09-01T10:00:20.000Z') },
      { traceId: 'd'.repeat(32), earliestStartUnixNano: null },
    ],
  });
  expect(
    placements.map((placement) => [
      placement.traceId[0],
      placement.kind === 'uncaused' ? placement.placedAfter : 'caused',
    ]),
  ).toEqual([
    ['a', null],
    ['b', 'act-1'],
    ['e', 'act-2'],
    ['c', 'act-2'],
    ['d', null],
  ]);
});

it('places ties after the later activity and skips activities without a readable start', () => {
  const tied = {
    ...second,
    activityId: 'act-3',
    sequence: 3,
    traceId: '3'.repeat(32),
    startedAt: second.startedAt,
  };
  const unreadable = {
    ...first,
    activityId: 'act-4',
    sequence: 4,
    traceId: '4'.repeat(32),
    startedAt: 'not-a-time',
  };
  const placements = placeTraces({
    activities: [unreadable, tied, second, first],
    traces: [{ traceId: 'f'.repeat(32), earliestStartUnixNano: ns('2026-09-01T10:00:20.000Z') }],
  });
  expect(placements).toEqual([
    {
      kind: 'uncaused',
      traceId: 'f'.repeat(32),
      placedAfter: 'act-3',
      earliestStartUnixNano: ns('2026-09-01T10:00:20.000Z'),
    },
  ]);
});

it('places 5,000 traces among 5,000 activities within 500 ms', () => {
  const base = Date.parse('2026-09-01T10:00:00.000Z');
  const activities = Array.from({ length: 5_000 }, (_, index) => ({
    activityId: `act-${String(index)}`,
    sequence: index,
    traceId: index.toString(16).padStart(32, 'a'),
    startedAt: new Date(base + index * 1_000).toISOString(),
  }));
  const traces = Array.from({ length: 5_000 }, (_, index) => ({
    traceId: index.toString(16).padStart(32, 'b'),
    earliestStartUnixNano: String(BigInt(base + index * 1_000 + 500) * 1_000_000n),
  }));
  const started = performance.now();
  const placements = placeTraces({ activities, traces });
  const elapsed = performance.now() - started;
  expect(placements).toHaveLength(5_000);
  expect(placements[4_999]).toMatchObject({ kind: 'uncaused', placedAfter: 'act-4999' });
  expect(elapsed).toBeLessThan(500);
});

/** The HTML report's own trace association for one trace inside the activity's window. */
function reportAssociations(input: {
  readonly activity: ReturnType<typeof completedHostActivity>;
  readonly traceId: string;
  readonly inWindow: string;
}) {
  const { activity, traceId, inWindow } = input;
  const request = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'worker' } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: 'aaaaaaaaaaaaaaaa',
                name: 'consume',
                startTimeUnixNano: ns(inWindow),
              },
            ],
          },
        ],
      },
    ],
  };
  const identity = { sessionId: 'calm-comet-ada', executionId: 'execution-1' };
  return projectObservations({
    observations: {
      kind: 'collector-session-found',
      lifecycle: {
        schemaVersion: 1,
        ...identity,
        revision: 1,
        runs: [],
        telemetry: {
          status: 'not-received',
          acceptedRequests: 0,
          acceptedSpans: 0,
          lastReceivedAt: null,
        },
      },
      fragments: [],
      traceIds: [traceId],
    },
    traceObservations: {
      kind: 'collector-traces-found',
      identity,
      traces: [{ traceId, fragments: [{ sequence: 1, receivedAt: inWindow, request }] }],
    },
    activities: [activity],
    context: createRedactionContext(),
  });
}

it('never presents the report temporal activity-window association as cause', () => {
  const activity = { ...completedHostActivity(), purpose: 'stimulus' as const };
  const inWindow = new Date(Date.parse(activity.startedAt) + 5).toISOString();
  const traceId = '9'.repeat(32);
  const report = reportAssociations({ activity, traceId, inWindow });
  // The fixture really triggers the report's temporal association...
  if (report.kind !== 'collector-session-found') {
    throw new Error(`unexpected ${report.kind}`);
  }
  expect(report.traces.sessionOnly.map((retained) => retained.association)).toEqual([
    {
      kind: 'activity-window',
      activityId: activity.activityId,
    },
  ]);
  // ...and causality ignores it, even when it is handed in alongside.
  const causality = {
    activityId: activity.activityId,
    sequence: activity.sequence,
    traceId: activity.telemetry.context.traceId,
    startedAt: activity.startedAt,
  };
  const trace = { traceId, earliestStartUnixNano: ns(inWindow) };
  const plain = placeTraces({ activities: [causality], traces: [trace] });
  const withWindow = {
    ...trace,
    association: { kind: 'activity-window', activityId: activity.activityId },
  };
  const fed = placeTraces({ activities: [causality], traces: [withWindow] });
  expect(plain).toEqual([
    {
      kind: 'uncaused',
      traceId,
      placedAfter: activity.activityId,
      earliestStartUnixNano: ns(inWindow),
    },
  ]);
  expect(fed).toEqual(plain);
});

it('returns the numerically earliest start, ignoring spans without one', () => {
  expect(
    earliestStart([
      { startTimeUnixNano: '1000' },
      { startTimeUnixNano: null },
      { startTimeUnixNano: '999' },
    ]),
  ).toBe('999');
  expect(earliestStart([{ startTimeUnixNano: null }])).toBeNull();
});

it('ends an activity window at the next start or the completion plus the grace', () => {
  const completedAt = '2026-01-01T00:00:01.000Z';
  const completed = Date.parse(completedAt);
  expect(ACTIVITY_WINDOW_GRACE_MS).toBe(5_000);
  expect(activityWindowEndMs({ completedAt, nextStartedAt: null })).toBe(completed + 5_000);
  expect(activityWindowEndMs({ completedAt, nextStartedAt: '2026-01-01T00:00:02.000Z' })).toBe(
    completed + 1_000,
  );
  expect(activityWindowEndMs({ completedAt: null, nextStartedAt: null })).toBe(
    Number.POSITIVE_INFINITY,
  );
});
