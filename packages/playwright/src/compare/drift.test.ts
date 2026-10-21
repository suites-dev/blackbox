import { describe, expect, it } from 'vitest';

import { compareSides } from './compare.js';
import { healthy, sideFixture, span, type SpanSpec } from './compare.fixture.js';

const payment = (spans: number) => span({ actor: 'payment', operation: 'POST', spans });
const compareSpans = (reference: readonly SpanSpec[], head: readonly SpanSpec[]) =>
  compareSides(
    sideFixture({ spans: reference }),
    sideFixture({ spans: head, attemptId: 'attempt-2' }),
  );

describe('application drift', () => {
  it('reports a count change with the span identities behind each side, and does not call it a duplicate', () => {
    const delta = compareSpans([...healthy, payment(1)], [...healthy, payment(2)]);
    expect(delta.outcome).toBe('observed-difference');
    const [only] = delta.drift.effects;
    expect(only).toMatchObject({
      change: 'count-differs',
      effect: { actor: 'payment', operation: 'POST', side: 'server' },
      reference: { count: 1 },
      head: { count: 2 },
      inference: 'undetermined',
    });
    expect(only.evidence.reference).toHaveLength(1);
    expect(only.evidence.head).toHaveLength(2);
    expect(JSON.stringify(delta)).not.toMatch(/duplicate/u);
  });

  it('reports an effect only one side observed as newly observed, with a witnessed inference', () => {
    const delta = compareSpans(healthy, [
      ...healthy,
      span({ actor: 'api', kind: 'http', operation: 'GET' }),
    ]);
    expect(delta.drift.effects).toHaveLength(1);
    expect(delta.drift.effects[0]).toMatchObject({
      change: 'newly-observed',
      inference: 'witnessed',
      reference: null,
    });
  });

  it('reports a changed outcome for the same operation', () => {
    const delta = compareSpans(
      [...healthy, span({ actor: 'payment', outcome: 'unknown' })],
      [...healthy, span({ actor: 'payment', outcome: 'failure' })],
    );
    expect(delta.drift.effects.map(({ change }) => change)).toEqual(['outcome-differs']);
  });

  it('keeps an effect that disappeared while its participant was still observed as drift, never as absence', () => {
    const delta = compareSpans(
      [...healthy, payment(1)],
      [...healthy, span({ actor: 'payment', operation: 'GET' })],
    );
    const changes = delta.drift.effects.map(({ change }) => change).sort();
    expect(changes).toEqual(['newly-observed', 'not-observed']);
    expect(JSON.stringify(delta.drift)).not.toContain('"absent"');
  });
});

describe('missing observations', () => {
  it('does not report effects of a participant the head never observed as removed', () => {
    const reference = [...healthy, span({ actor: 'worker', operation: 'GET' })];
    const delta = compareSides(
      sideFixture({ spans: reference, activated: ['api', 'worker'] }),
      sideFixture({
        spans: healthy.filter(({ actor }) => actor === 'api'),
        activated: ['api', 'worker'],
        attemptId: 'attempt-2',
      }),
    );
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.drift.effects).toEqual([]);
    expect(delta.coverage.map(({ cause }) => cause)).toEqual(
      expect.arrayContaining([expect.stringContaining('worker: activated-without-observation')]),
    );
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('coverage-explained-difference');
  });

  it('keeps real drift visible next to a coverage gap', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)], activated: ['api', 'worker', 'payment'] }),
      sideFixture({
        spans: [span({ actor: 'api' }), span({ actor: 'api', side: '3', spans: 3 })],
        activated: ['api', 'worker'],
        attemptId: 'attempt-2',
      }),
    );
    expect(delta.outcome).toBe('observed-difference');
    expect(delta.drift.effects.map(({ effect }) => effect.actor)).toContain('api');
    expect(delta.coverage.length).toBeGreaterThan(0);
  });

  it('only says absent when the head capture is demonstrated complete', () => {
    const reference = sideFixture({ spans: [...healthy, payment(1)] });
    const head = sideFixture({ spans: healthy, attemptId: 'attempt-2' });
    const complete = {
      ...head,
      envelope: {
        ...head.envelope,
        observed: {
          ...head.envelope.observed,
          completeness: { ...head.envelope.observed.completeness, status: 'complete' },
        },
      },
    };
    expect(compareSides(reference, complete).drift.effects.map(({ change }) => change)).toEqual([
      'absent',
    ]);
    expect(compareSides(reference, head).drift.effects.map(({ change }) => change)).toEqual([
      'not-observed',
    ]);
  });
});

describe('infrastructure noise', () => {
  const pool = (spans: number) =>
    span({
      actor: 'api',
      kind: 'db',
      side: '3',
      operation: 'unknown',
      infrastructure: 'connection-pool',
      spans,
    });
  const establish = (spans: number) =>
    span({
      actor: 'api',
      kind: 'db',
      side: '3',
      operation: 'unknown',
      infrastructure: 'connection-establishment',
      spans,
    });

  it('keeps connection management out of application drift but preserves the diagnostic difference', () => {
    const delta = compareSpans([...healthy, pool(1)], [...healthy, pool(1), establish(1)]);
    expect(delta.outcome).toBe('no-observed-difference');
    expect(delta.drift.effects).toEqual([]);
    expect(delta.infrastructure).toEqual([
      expect.objectContaining({
        actor: 'api',
        class: 'connection-establishment',
        reference: 0,
        head: 1,
      }),
      expect.objectContaining({ actor: 'api', class: 'connection-pool', reference: 1, head: 1 }),
    ]);
  });

  it('does not discard an unclassified database effect: it is still application drift', () => {
    const unclassified = span({ actor: 'api', kind: 'db', side: '3', operation: 'unknown' });
    const delta = compareSpans(
      [...healthy, pool(1), unclassified],
      [...healthy, pool(1), unclassified, unclassified],
    );
    expect(delta.outcome).toBe('observed-difference');
    expect(delta.drift.effects[0]).toMatchObject({
      change: 'count-differs',
      effect: { kind: 'db', actor: 'api' },
    });
  });

  it('is deterministic whatever the order of the observed spans', () => {
    const forward = compareSpans([...healthy, payment(1)], [...healthy, payment(2)]);
    const reversed = compareSides(
      sideFixture({ spans: [payment(1), ...[...healthy].reverse()] }),
      sideFixture({ spans: [payment(2), ...[...healthy].reverse()], attemptId: 'attempt-2' }),
    );
    expect(
      reversed.drift.effects.map(({ change, effect, reference, head }) => ({
        change,
        effect,
        reference,
        head,
      })),
    ).toEqual(
      forward.drift.effects.map(({ change, effect, reference, head }) => ({
        change,
        effect,
        reference,
        head,
      })),
    );
  });
});
