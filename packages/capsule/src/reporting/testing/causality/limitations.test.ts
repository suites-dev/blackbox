import { describe, expect, it } from 'vitest';

import { renderCapsuleHtml } from '../../../index.js';
import {
  ACTIVITY_START,
  CAUSED_TRACE,
  UNLINKED_TRACE,
  activity,
  completedDriverActivity,
  first,
  report,
  run,
  session,
  traces,
} from './causality.fixture.js';
import { child, overlapping, server, stimulus, unlinked } from './scenario.fixture.js';

describe('limitations', () => {
  it('names an untraced command', () => {
    const document = report({
      activities: [activity({ activityId: 'raw', sequence: 1, traceId: CAUSED_TRACE })],
      observations: session([]),
    });
    expect(first(document.activityCausality).limitations).toEqual([{ kind: 'untraced' }]);
  });

  it('names context not carried through shared state', () => {
    const shared = completedDriverActivity();
    const document = report({
      activities: [
        {
          ...shared,
          telemetry: {
            ...shared.telemetry,
            context: { ...shared.telemetry.context, traceId: CAUSED_TRACE },
          },
        },
      ],
      observations: session([]),
    });
    expect(first(document.activityCausality).limitations).toEqual([
      { kind: 'context-not-carried', resource: 'postgresql' },
    ]);
  });

  it('names an orphan span whose parent is not retained', () => {
    const document = report({
      activities: [stimulus],
      observations: session([CAUSED_TRACE]),
      traceObservations: traces([{ ...server, parentSpanId: 'ffffffffffffffff' }]),
    });
    const causality = first(document.activityCausality);
    expect(first(first(causality.causedTraces).tree).orphan).toBe('not-retained');
    expect(causality.limitations).toContainEqual({
      kind: 'orphan-span',
      spanId: 'a000000000000001',
      trace: CAUSED_TRACE,
    });
  });

  it('marks the orphan not yet observed while the capsule runs', () => {
    const document = report({
      state: 'running',
      activities: [stimulus],
      observations: session([CAUSED_TRACE], [run({ receiver: 'ready', shutdown: 'not-started' })]),
      traceObservations: traces([{ ...server, parentSpanId: 'ffffffffffffffff' }]),
    });
    expect(first(first(first(document.activityCausality).causedTraces).tree).orphan).toBe(
      'not-yet-observed',
    );
  });

  it('states a traced activity whose trace was not retained as an unavailable observation', () => {
    const document = report({
      activities: [stimulus],
      observations: session([CAUSED_TRACE]),
      traceObservations: traces([]),
    });
    expect(first(document.activityCausality).limitations).toContainEqual({
      kind: 'observation-unavailable',
      trace: CAUSED_TRACE,
      reason: 'not-retained',
    });
  });

  it('records the unknown cause of each uncaused trace on the activity and the capsule', () => {
    const document = overlapping();
    const unknown = { kind: 'causality-unknown', trace: UNLINKED_TRACE };
    expect(first(document.activityCausality).limitations).toContainEqual(unknown);
    expect(document.limitations).toContainEqual(unknown);
  });
});

describe('safe to share', () => {
  const SECRET_PATH = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const SECRET_ARG = 'private';

  it('never carries a command line secret or a raw path secret, in JSON or HTML', () => {
    const rawPath = [
      ['http.request.method', 'GET'],
      ['http.target', `/password-reset/${SECRET_PATH}?token=${SECRET_PATH}`],
      ['url.path', `/password-reset/${SECRET_PATH}`],
    ] as const;
    const document = report({
      activities: [stimulus, completedDriverActivity()],
      observations: session([CAUSED_TRACE, UNLINKED_TRACE]),
      // One trace in the activity's tree, one with no known cause (shown with its attributes).
      traceObservations: traces([
        { ...server, attributes: rawPath },
        { ...unlinked, attributes: rawPath },
      ]),
    });
    for (const text of [JSON.stringify(document), renderCapsuleHtml({ report: document })]) {
      expect(text).not.toContain(SECRET_PATH);
      expect(text).not.toContain(`"${SECRET_ARG}"`);
    }
    expect(JSON.stringify(document.activityCausality)).toContain('GET /password-reset/{…}');
  });
});

describe('report words', () => {
  it('uses none of success, successful, passed, verified, effect or effects', () => {
    const text = JSON.stringify([
      report({
        activities: [stimulus],
        observations: session([CAUSED_TRACE, UNLINKED_TRACE]),
        traceObservations: traces([server, child, unlinked]),
      }).limitations,
      ACTIVITY_START,
    ]);
    expect(text).not.toMatch(/\b(?:success|successful|passed|verified|effects?)\b/iu);
  });
});
