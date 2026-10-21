import { describe, expect, it } from 'vitest';

import { compareAttempts, compareSides } from './compare.js';
import { claimOf } from './delta.fixture.js';
import { healthy, sideFixture, span } from './compare.fixture.js';
import type { AtMostClaim } from './types.js';

const payment = (spans: number) => span({ actor: 'payment', operation: 'POST', spans });
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
  stateSubject: 'payment-intents',
} satisfies AtMostClaim;
const noState = { ...claim, stateSubject: null } satisfies AtMostClaim;
const state = (...ids: string[]) => [{ subject: 'payment-intents', identities: ids }];
const finding = claimOf;

describe('authoritative state', () => {
  it('reports a difference in reported state as definite drift', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)], state: state('pi_1') }),
      sideFixture({
        spans: [...healthy, payment(2)],
        state: state('pi_1', 'pi_2'),
        attemptId: 'attempt-2',
      }),
    );
    expect(delta.outcome).toBe('observed-difference');
    expect(delta.drift.state).toEqual([
      expect.objectContaining({
        subject: 'payment-intents',
        change: 'count-differs',
        reference: expect.objectContaining({ distinct: 1 }),
        head: expect.objectContaining({ distinct: 2 }),
      }),
    ]);
  });

  it('keeps state reported on only one side unresolved', () => {
    const delta = compareSides(
      sideFixture({ spans: healthy, state: state('pi_1') }),
      sideFixture({ spans: healthy, attemptId: 'attempt-2' }),
    );
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('state-reported-on-one-side');
  });

  it('stores identities as digests, never as the reported values', () => {
    const side = sideFixture({ spans: healthy, state: state('pi_secret_1') });
    expect(JSON.stringify(side.envelope.state)).not.toContain('pi_secret_1');
  });
});

describe('atMost claims are evaluated independently of the comparison', () => {
  it('refutes through state, even though the head lost a participant to missing telemetry', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)], state: state('pi_1') }),
      sideFixture({
        spans: [span({ actor: 'api' }), payment(2)],
        activated: ['api', 'worker', 'payment'],
        state: state('pi_1', 'pi_2'),
        attemptId: 'attempt-2',
      }),
      { claims: [claim] },
    );
    expect(finding(delta, 'head')).toMatchObject({
      status: 'refuted',
      basis: 'state',
      businessOperationsEstablished: true,
      distinctRecords: 2,
    });
    expect(finding(delta, 'reference')).toMatchObject({ status: 'not-refuted' });
    expect(delta.coverage.length).toBeGreaterThan(0);
  });

  it('shows only a span excess, not a business violation, when no state establishes the operations', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)] }),
      sideFixture({ spans: [...healthy, payment(2)], attemptId: 'attempt-2' }),
      { claims: [noState] },
    );
    expect(finding(delta, 'head')).toMatchObject({
      status: 'span-excess',
      basis: 'spans',
      businessOperationsEstablished: false,
      spans: 2,
    });
  });

  it('treats a span excess that state does not confirm as a retry or duplicated span', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)], state: state('pi_1') }),
      sideFixture({
        spans: [...healthy, payment(2)],
        state: state('pi_1'),
        attemptId: 'attempt-2',
      }),
      { claims: [claim] },
    );
    expect(finding(delta, 'head')).toMatchObject({
      status: 'suspect',
      spans: 2,
      distinctRecords: 1,
    });
  });

  it('counts each span identity once and never merges spans that look alike', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)] }),
      sideFixture({ spans: [...healthy, payment(3)], attemptId: 'attempt-2' }),
      { claims: [noState] },
    );
    expect(finding(delta, 'head').spans).toBe(3);
    expect(new Set(finding(delta, 'head').evidence).size).toBe(3);
  });

  it('cannot be evaluated without any observation or state for the attempt', () => {
    const empty = sideFixture({ spans: [], attemptId: 'attempt-2' });
    const side = { ...empty, snapshot: null, snapshotProblem: 'gone' };
    expect(
      finding(compareSides(sideFixture({ spans: healthy }), side, { claims: [noState] }), 'head'),
    ).toMatchObject({ status: 'unevaluable' });
  });

  it('keeps verification findings apart from drift', () => {
    const delta = compareSides(
      sideFixture({ spans: [...healthy, payment(1)] }),
      sideFixture({ spans: [...healthy, payment(1)], attemptId: 'attempt-2', status: 'failed' }),
    );
    expect(delta.outcome).toBe('no-observed-difference');
    expect(delta.verification.head.testStatus.status).toBe('failed');
    expect(delta.verification.reference.testStatus.status).toBe('passed');
  });
});

describe('attempts and retries', () => {
  it('compares a failed attempt and its retry independently, each against the reference', () => {
    const reference = sideFixture({ spans: [...healthy, payment(1)], state: state('pi_1') });
    const failed = sideFixture({
      spans: [...healthy, payment(2)],
      state: state('pi_1', 'pi_2'),
      attemptId: 'attempt-2',
      retry: 0,
      status: 'failed',
    });
    const retried = sideFixture({
      spans: [...healthy, payment(1)],
      state: state('pi_1'),
      attemptId: 'attempt-3',
      retry: 1,
    });
    const [first, second] = compareAttempts(reference, [failed, retried], { claims: [claim] });
    expect(first.outcome).toBe('observed-difference');
    expect(first.verification.head).toMatchObject({ attemptId: 'attempt-2', retry: 0 });
    expect(second.outcome).toBe('no-observed-difference');
    expect(second.verification.head).toMatchObject({ attemptId: 'attempt-3', retry: 1 });
    expect(first.digest).not.toBe(second.digest);
    expect(first.invocation).toBe('unestablished');
  });
});
