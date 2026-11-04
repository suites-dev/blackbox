import { describe, expect, it } from 'vitest';

import { buildFinalSnapshot } from '../../effects/final-snapshot.js';
import { compareSides } from '../compare.js';
import { loadSide } from '../side.js';
import { checkOf } from './delta.fixture.js';
import { envelopeWithSnapshotBody, sideFixture, snapshotWith } from './compare.fixture.js';
import type { AtMostClaim, ComparisonSide } from '../types.js';

function unavailable(kind: 'unavailable' | 'rejected'): ComparisonSide {
  const template = snapshotWith([]);
  const snapshot = buildFinalSnapshot({
    attempt: { ...template.attempt, status: 'failed' },
    collector: { state: 'missing', message: 'collector missing' },
    stimuli: template.stimuli.activities,
    read: { kind, message: `capture ${kind}` },
  });
  const body = JSON.stringify(snapshot);
  const loaded = loadSide({ envelope: envelopeWithSnapshotBody(body), snapshotBody: body });
  if (loaded.kind !== 'loaded') {
    throw new Error('fixture envelope rejected');
  }
  expect(loaded.side.snapshot!.evidence.kind).toBe('not-admitted');
  expect(loaded.side.snapshotProblem).toBeNull();
  return loaded.side;
}

describe('snapshot presence does not establish evidence admission', () => {
  it.each(['reference', 'head', 'both'] as const)(
    'keeps %s unadmitted evidence inconclusive and retains the capture reasons',
    (which) => {
      const reference = which === 'head' ? sideFixture({ spans: [] }) : unavailable('unavailable');
      const head = which === 'reference' ? sideFixture({ spans: [] }) : unavailable('rejected');
      const delta = compareSides(reference, head);
      expect(delta.comparability.level).toBe('limited');
      expect(delta.outcome).toBe('inconclusive');
      expect(checkOf(delta, 'evidence')).toMatchObject({
        result: 'unknown',
        effect: 'limits-conclusions',
      });
      const unresolved = delta.unresolved.find(({ kind }) => kind === 'evidence-unavailable');
      expect(unresolved).toBeDefined();
      for (const name of which === 'both' ? ['reference', 'head'] : [which]) {
        const state = name === 'reference' ? 'unavailable' : 'rejected';
        expect(unresolved!.detail).toContain(`${name}: evidence not admitted (${state})`);
        expect(unresolved!.detail).toContain(`capture ${state}`);
        expect(unresolved!.detail).toContain(`observation-${state}`);
        expect(unresolved!.detail).toContain('collector-lifecycle-missing');
      }
    },
  );

  it('allows admitted empty captures to agree without claiming completeness', () => {
    const reference = sideFixture({ spans: [] });
    const head = sideFixture({ spans: [], attemptId: 'head' });
    const delta = compareSides(reference, head);
    expect(reference.snapshot!.evidence.kind).toBe('admitted');
    expect(reference.snapshot!.completeness.closed).toBe(false);
    expect(delta.outcome).toBe('no-observed-difference');
    expect(checkOf(delta, 'evidence').result).toBe('equal');
    expect(delta.unresolved).toEqual([]);
  });
});

describe('a span-only claim over evidence that was not admitted', () => {
  const claim = {
    id: 'one-payment',
    n: 1,
    selector: {
      kind: 'http',
      actor: 'payment',
      side: 'server',
      operation: 'POST',
      target: 'unknown',
    },
    stateSubject: null,
  } satisfies AtMostClaim;

  it('cannot be evaluated, like a missing snapshot', () => {
    const delta = compareSides(unavailable('unavailable'), unavailable('rejected'), {
      claims: [claim],
    });
    expect(delta.verification.claims.map(({ status, basis }) => [status, basis])).toEqual([
      ['unevaluable', 'none'],
      ['unevaluable', 'none'],
    ]);
  });
});
