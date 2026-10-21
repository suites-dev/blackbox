import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanup,
  behaviorOf,
  defined,
  execution,
  failedAcquisition,
  ingest,
  openHistory,
} from './history.fixture.js';
import type { AliasBody } from './alias.js';

afterEach(cleanup);

const alias = (from: string, to: string): AliasBody => ({
  aliasVersion: 1,
  kind: 'behavior-alias',
  canonicalization: 'bb-jcs-1',
  from,
  to,
  reason: 'the scenario was renamed',
  assertedBy: 'reviewer',
  recordedAt: '2026-01-01T00:01:00.000Z',
  witnesses: { from: null, to: null },
});

async function renamed() {
  const history = await openHistory();
  const old = await ingest(
    history,
    execution({
      behavior: behaviorOf('subscription.pay'),
      attemptId: 'old',
      capturedAt: '2026-01-01T00:00:10.000Z',
    }),
  );
  const current = await ingest(
    history,
    execution({
      behavior: behaviorOf('subscription.payment'),
      attemptId: 'new',
      capturedAt: '2026-01-01T00:00:20.000Z',
    }),
  );
  return { history, old, current };
}

describe('behavior identity evolution', () => {
  it('keeps similar names apart until someone records an alias', async () => {
    const { history, old, current } = await renamed();
    expect((await history.behaviors()).map(({ behaviorId }) => behaviorId)).toEqual([
      'subscription.pay',
      'subscription.payment',
    ]);
    expect(
      await history.behaviorHistory('subscription.payment', { followAliases: true }),
    ).toHaveLength(1);
    const delta = await history.compare(old, current, { claims: [], record: false });
    expect(delta.outcome).toBe('invalid');
    expect(delta.behaviorAliases).toEqual([]);
  });

  it('after an alias is recorded, joins the history and compares across the rename without rewriting anything', async () => {
    const { history, old, current } = await renamed();
    const { alias: recorded } = await history.recordAlias(
      alias('subscription.pay', 'subscription.payment'),
    );
    const merged = await history.behaviorHistory('subscription.payment', { followAliases: true });
    expect(merged.map(({ behaviorId, via }) => `${behaviorId}:${via}`)).toEqual([
      'subscription.pay:alias',
      'subscription.payment:behavior-id',
    ]);
    const delta = await history.compare(old, current, { claims: [], record: false });
    expect(delta.outcome).toBe('no-observed-difference');
    expect(delta.behaviorAliases).toEqual([
      { alias: recorded.digest, from: 'subscription.pay', to: 'subscription.payment' },
    ]);
    expect(
      defined(delta.comparability.checks.find(({ name }) => name === 'behavior')).detail,
    ).toContain('ids were not merged');
    const detail = await history.execution(old);
    expect(defined(detail).envelope.identity.behavior.id).toBe('subscription.pay');
    const summaries = await history.behaviors();
    expect(
      defined(summaries.find(({ behaviorId }) => behaviorId === 'subscription.payment'))
        .aliasedFrom,
    ).toEqual(['subscription.pay']);
  });

  it('refuses to follow an ambiguous alias chain', async () => {
    const { history, old, current } = await renamed();
    await history.recordAlias(alias('subscription.pay', 'subscription.payment'));
    await history.recordAlias(alias('subscription.pay', 'subscription.other'));
    const delta = await history.compare(old, current, { claims: [], record: false });
    expect(delta.outcome).toBe('invalid');
  });

  it('attaches a receipt with only a derived id to the declared behavior when exactly one declares it', async () => {
    const history = await openHistory();
    const derivedId = 'derived:bbbbbbbbbbbbbbbb';
    await ingest(
      history,
      execution({
        behavior: {
          id: 'subscription.payment',
          basis: 'declared',
          derivedId,
          declaration: { state: 'declared' },
        },
      }),
    );
    await history.ingestReceipt(
      failedAcquisition(
        { id: derivedId, basis: 'derived', derivedId, declaration: { state: 'absent' } },
        40,
      ),
    );
    const entries = await history.behaviorHistory('subscription.payment', { followAliases: false });
    expect(entries.map(({ kind, via }) => `${kind}:${via}`)).toEqual([
      'execution:behavior-id',
      'attempt-without-evidence:derived-id',
    ]);
  });
});
