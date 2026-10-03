import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { capsuleActivityListScript } from '../html/activities/list.js';
import { capsuleActivityRowScript } from '../html/activities/row.js';
import { capsuleObservationPolicyScript } from '../html/observations/policy.js';
import { capsuleObservationSummaryScript } from '../html/observations/summary.js';

/** Runs `expression` after the client script's function declarations, in a fresh VM. */
function evaluate(script: string, expression: string): unknown {
  const context = { output: null as unknown };
  new Script(`${script}\noutput = ${expression};`).runInNewContext(context);
  return context.output;
}

describe('stdout and stderr retention text', () => {
  const complete = { kind: 'complete', originalBytes: 368 };
  const document = {
    activities: [{ activityId: 'a' }, { activityId: 'b' }],
    redactions: {
      entries: [
        { kind: 'sensitive-output', location: 'activities[1].outcome.stdout' },
        { kind: 'sensitive-output', location: 'activities[1].outcome.argv[7]' },
        { kind: 'sensitive-output', location: 'activities[0].outcome.process.stdout' },
      ],
    },
  };

  it('says what redaction rewrote instead of "retained completely"', () => {
    const text = (redactions: number) =>
      evaluate(
        capsuleActivityRowScript,
        `retentionText(${JSON.stringify(complete)}, ${String(redactions)})`,
      );
    expect(text(0)).toBe('368 bytes retained completely');
    expect(text(1)).toBe('368 original bytes retained · rewritten by 1 redaction');
    expect(text(2)).toBe('368 original bytes retained · rewritten by 2 redactions');
  });

  it('counts the redactions of one activity stream, for host and driver outcomes', () => {
    const counts = evaluate(
      capsuleActivityRowScript,
      `((d) => [
        streamRedactions(d, d.activities[1], 'stdout'),
        streamRedactions(d, d.activities[1], 'stderr'),
        streamRedactions(d, d.activities[0], 'stdout'),
      ])(${JSON.stringify(document)})`,
    );
    expect(counts).toEqual([1, 0, 1]);
  });
});

/** Minimal stand-ins for the client view's DOM helpers: plain objects instead of elements. */
const helpers = `
const badge = (text, tone) => ({ badge: text, tone: tone || 'neutral' });
const p = (text) => ({ p: text });
const add = (parent, ...children) => { parent.children.push(...children.filter(Boolean)); return parent; };
const summaryCard = (name) => ({ card: name, children: [] });
`;

describe('activity and overview span counts', () => {
  const blackboxOnly = {
    observations: {
      kind: 'collector-session-found',
      traces: {
        sessionOnly: [
          { association: { kind: 'activity-window', activityId: 'b' } },
          { association: { kind: 'session-only' } },
        ],
      },
    },
    activityTelemetry: [
      { kind: 'available', activityId: 'b', spans: [{ service: 'blackbox-capsule' }] },
      {
        kind: 'available',
        activityId: 'a',
        spans: [{ service: 'blackbox-capsule' }, { service: 'auth' }, { service: 'auth' }],
      },
    ],
  };

  it('counts system spans apart from Blackbox spans and names the window traces', () => {
    const script = `${helpers}${capsuleActivityListScript}`;
    const data = JSON.stringify(blackboxOnly);
    expect(evaluate(script, `telemetryBadges(${data}, { activityId: 'b' })`)).toEqual([
      { badge: '0 system spans', tone: 'warn' },
      { badge: '1 trace in its time window', tone: 'neutral' },
    ]);
    expect(evaluate(script, `telemetryBadges(${data}, { activityId: 'a' })`)).toEqual([
      { badge: '2 system spans', tone: 'good' },
    ]);
    expect(evaluate(capsuleObservationSummaryScript, `correlatedSpanCounts(${data})`)).toEqual({
      system: 2,
      blackbox: 2,
    });
  });
});

describe('observation policy card', () => {
  it('lists every boundary with its status, and says when no policy was recorded', () => {
    const script = `${helpers}${capsuleObservationPolicyScript}`;
    const recorded = {
      observationPolicy: {
        kind: 'recorded',
        policyId: 'tt-login-traced-v1',
        terminalObservationWindowMs: 5000,
        boundaries: [{ id: 'effects.http', kind: 'http', required: true, status: 'not-evaluated' }],
      },
    };
    expect(JSON.stringify(evaluate(script, `policyCard(${JSON.stringify(recorded)})`))).toContain(
      'effects.http · http · required · not evaluated',
    );
    expect(JSON.stringify(evaluate(script, 'policyCard({})'))).toContain('No observation policy');
  });
});
