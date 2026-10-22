import { describe, expect, it } from 'vitest';

import { compareSides } from '../compare.js';
import { healthy, sideFixture, span } from './compare.fixture.js';

const payment = (spans: number) => span({ actor: 'payment', operation: 'POST', spans });

describe('a snapshot that kept only part of what was observed', () => {
  const reference = () => sideFixture({ spans: [...healthy, payment(1)] });

  it('never reports no observed difference when either side omitted effects', () => {
    const same = [...healthy, payment(1)];
    const headCut = compareSides(
      reference(),
      sideFixture({ spans: same, attemptId: 'b', omittedEffects: 7 }),
    );
    expect(headCut.outcome).toBe('inconclusive');
    expect(headCut.unresolved).toEqual([
      expect.objectContaining({
        kind: 'evidence-truncated',
        detail: expect.stringContaining('7 effects'),
      }),
    ]);
    const referenceCut = compareSides(
      sideFixture({ spans: same, omittedEffects: 3 }),
      sideFixture({ spans: same, attemptId: 'b' }),
    );
    expect(referenceCut.outcome).toBe('inconclusive');
  });

  it('keeps a witnessed difference in the retained part, and still says part was omitted', () => {
    const delta = compareSides(
      reference(),
      sideFixture({ spans: [...healthy, payment(2)], attemptId: 'b', omittedEffects: 4 }),
    );
    expect(delta.outcome).toBe('observed-difference');
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('evidence-truncated');
  });

  it('does not read agreement into strings the snapshot cut at its display limit', () => {
    const same = [...healthy, payment(1)];
    const delta = compareSides(
      reference(),
      sideFixture({ spans: same, attemptId: 'b', truncatedStrings: 2 }),
    );
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.unresolved).toEqual([
      expect.objectContaining({
        kind: 'evidence-truncated',
        detail: expect.stringContaining('2 strings cut at the display limit'),
      }),
    ]);
  });

  it('adds nothing when nothing was omitted', () => {
    const delta = compareSides(
      reference(),
      sideFixture({ spans: [...healthy, payment(1)], attemptId: 'b' }),
    );
    expect(delta.outcome).toBe('no-observed-difference');
    expect(delta.unresolved).toEqual([]);
  });
});
