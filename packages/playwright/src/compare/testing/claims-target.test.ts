import { describe, expect, it } from 'vitest';

import { observedEffects } from '../../envelope/effects.js';
import { compareSides } from '../compare.js';
import { claimOf } from './delta.fixture.js';
import { sideFixture, span } from './compare.fixture.js';
import type { AtMostClaim } from '../types.js';

const claim = {
  id: 'one-charge',
  n: 1,
  selector: {
    kind: 'http',
    actor: 'payment',
    side: 'server',
    operation: 'POST',
    target: '/charge',
  },
  stateSubject: null,
} satisfies AtMostClaim;

const payment = (target: string, spans: number) => span({ actor: 'payment', target, spans });

describe('atMost target selection', () => {
  it.each([1, 2])('counts only /charge evidence with %i selected spans', (count) => {
    const reference = sideFixture({ spans: [payment('/charge', 1)] });
    const head = sideFixture({
      spans: [payment('/charge', count), payment('/refund', 3)],
      attemptId: 'head',
    });
    const expected = observedEffects(head.snapshot!)
      .filter(({ target }) => target === '/charge')
      .flatMap(({ spanRefs }) => spanRefs)
      .sort();
    const refunds = observedEffects(head.snapshot!)
      .filter(({ target }) => target === '/refund')
      .flatMap(({ spanRefs }) => spanRefs);
    expect(expected).toHaveLength(count);
    expect(refunds).toHaveLength(3);
    const delta = compareSides(reference, head, { claims: [claim] });
    expect(claimOf(delta, 'head')).toMatchObject({
      status: count === 1 ? 'not-refuted' : 'span-excess',
      basis: 'spans',
      spans: count,
      evidence: expected,
      businessOperationsEstablished: false,
    });
    expect(claimOf(delta, 'reference').spans).toBe(1);
    for (const ref of refunds) {
      expect(claimOf(delta, 'head').evidence).not.toContain(ref);
    }
  });
});
