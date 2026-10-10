import { describe, expect, it } from 'vitest';

import {
  CAUSED_TRACE,
  UNLINKED_TRACE,
  activity,
  first,
  report,
  session,
  traces,
} from './causality.fixture.js';
import { overlapping, unlinked } from './scenario.fixture.js';

describe('cause only by trace context', () => {
  it('lists an overlapping trace under no known cause, never under the activity', () => {
    const document = overlapping();
    const causality = first(document.activityCausality);
    expect(causality.causedTraces.map((trace) => trace.traceId)).toEqual([CAUSED_TRACE]);
    expect(JSON.stringify(causality.causedTraces)).not.toContain('consume');
    expect(document.uncaused).toEqual([
      {
        trace: UNLINKED_TRACE,
        placedAfter: 'c0ffee00-0000-4000-8000-000000000001',
        rootService: 'worker',
        rootTitle: 'process orders',
      },
    ]);
  });

  it('keeps the temporal association readable next to the causal fields', () => {
    const { observations } = overlapping();
    expect(observations.kind).toBe('collector-session-found');
    if (observations.kind === 'collector-session-found') {
      expect(observations.traces.sessionOnly).toEqual([
        expect.objectContaining({
          traceId: UNLINKED_TRACE,
          association: {
            kind: 'activity-window',
            activityId: 'c0ffee00-0000-4000-8000-000000000001',
          },
        }),
      ]);
    }
  });

  it('does not attribute a trace by time when the activity has no trace of its own', () => {
    const document = report({
      activities: [activity({ activityId: 'a', sequence: 1, traceId: CAUSED_TRACE })],
      observations: session([UNLINKED_TRACE]),
      traceObservations: traces([unlinked]),
    });
    expect(first(document.activityCausality).causedTraces).toEqual([]);
    expect(document.uncaused.map((item) => item.trace)).toEqual([UNLINKED_TRACE]);
  });

  it('labels each activity by the evidence it provides, from its purpose', () => {
    const document = report({
      activities: [
        activity({ activityId: 's', sequence: 1, traceId: '1'.repeat(32), purpose: 'setup' }),
        activity({ activityId: 'r', sequence: 2, traceId: '2'.repeat(32), purpose: 'stimulus' }),
        activity({ activityId: 'c', sequence: 3, traceId: '3'.repeat(32), purpose: 'inspection' }),
      ],
      observations: session([]),
    });
    expect(document.activityCausality.map((item) => item.evidence)).toEqual([
      'state-preparation',
      'response',
      'state-check',
    ]);
  });
});
