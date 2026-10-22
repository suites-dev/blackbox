import { afterEach, describe, expect, it } from 'vitest';

import { digestBytes } from '../../envelope/index.js';
import type { BehaviorHistory } from '../history.js';
import {
  behaviorOf,
  claim,
  cleanup,
  defined,
  doubleSpans,
  execution,
  failedAcquisition,
  goodSpans,
  ingest,
  openHistory,
} from './history.fixture.js';

afterEach(cleanup);

const id = 'subscription.payment';
const at = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`;

/** A healthy at c1, the regression at c2, the repair at c3 (same tree as c1), a failed retry of B, and a failed acquisition. */
async function accumulate(history: BehaviorHistory) {
  const a = await ingest(
    history,
    execution({ attemptId: 'a', commit: 'c1', tree: 't1', capturedAt: at(10), invocation: 'i1' }),
  );
  const bFailed = await ingest(
    history,
    execution({
      attemptId: 'b0',
      commit: 'c2',
      tree: 't2',
      capturedAt: at(20),
      invocation: 'i2',
      status: 'failed',
      spans: doubleSpans,
      state: [{ subject: 'payment-intents', identities: ['pi_1', 'pi_2'] }],
    }),
  );
  const bRetry = await ingest(
    history,
    execution({
      attemptId: 'b1',
      retry: 1,
      commit: 'c2',
      tree: 't2',
      capturedAt: at(21),
      invocation: 'i2',
      status: 'failed',
      spans: doubleSpans,
      state: [{ subject: 'payment-intents', identities: ['pi_1', 'pi_2'] }],
    }),
  );
  const c = await ingest(
    history,
    execution({ attemptId: 'c', commit: 'c3', tree: 't1', capturedAt: at(30), invocation: 'i3' }),
  );
  await history.ingestReceipt(failedAcquisition(behaviorOf(id), 25));
  return { a, bFailed, bRetry, c };
}

describe('behavior history', () => {
  it('lists one stable behavior with all its executions and the attempt that left no evidence', async () => {
    const history = await openHistory();
    await accumulate(history);
    const [summary] = await history.behaviors();
    expect(summary).toMatchObject({
      behaviorId: id,
      executions: 4,
      attemptsWithoutEvidence: 1,
      revisions: 3,
    });
  });

  it('orders the history chronologically and marks revision changes and a tree seen before', async () => {
    const history = await openHistory();
    await accumulate(history);
    const entries = await history.behaviorHistory(id, { followAliases: false });
    expect(
      entries.map(
        (entry) =>
          `${entry.attemptId ?? 'none'}:${entry.source === null ? 'receipt' : entry.source.commit}`,
      ),
    ).toEqual(['a:c1', 'b0:c2', 'b1:c2', 'none:receipt', 'c:c3']);
    expect(entries.map((entry) => entry.revisionChanged)).toEqual([
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(entries.map((entry) => entry.treeSeenBefore)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(entries[3]).toMatchObject({
      kind: 'attempt-without-evidence',
      receiptStatus: 'acquisition-failed',
      envelopeId: null,
      observation: null,
    });
  });

  it('keeps a failed attempt and its passing retry as separate entries sharing an invocation', async () => {
    const history = await openHistory();
    await accumulate(history);
    const entries = (await history.behaviorHistory(id, { followAliases: false })).filter(
      (entry) => entry.invocation === 'i2',
    );
    expect(entries.map(({ attemptId, retry, status }) => [attemptId, retry, status])).toEqual([
      ['b0', 0, 'failed'],
      ['b1', 1, 'failed'],
    ]);
  });

  it('retrieves a specific execution with its snapshot and the state of each evidence reference', async () => {
    const history = await openHistory();
    const { a } = await accumulate(history);
    const detail = await history.execution(a);
    expect(defined(detail).snapshotBody).not.toBeNull();
    expect(defined(detail).evidence.map(({ kind, status }) => `${kind}:${status}`)).toEqual([
      'final-snapshot:stored',
    ]);
    expect(await history.execution(digestBytes('unknown'))).toBeNull();
  });
});

describe('comparing selected executions', () => {
  it('shows the regression A to B and the repair B to C, with the violation kept apart from the drift', async () => {
    const history = await openHistory();
    const { a, bFailed, c } = await accumulate(history);
    const regression = await history.compare(a, bFailed, { claims: [claim], record: true });
    expect(regression.outcome).toBe('observed-difference');
    expect(
      defined(regression.verification.claims.find(({ side }) => side === 'head')),
    ).toMatchObject({
      status: 'refuted',
      basis: 'state',
    });
    expect(regression.drift.state).toHaveLength(1);
    const repair = await history.compare(bFailed, c, { claims: [claim], record: true });
    expect(repair.outcome).toBe('observed-difference');
    expect(repair.verification.claims.map(({ side, status }) => `${side}:${status}`)).toEqual([
      'reference:refuted',
      'head:not-refuted',
    ]);
    const restored = await history.compare(a, c, { claims: [claim], record: false });
    expect(restored.outcome).toBe('no-observed-difference');
    expect(restored.association.relation).toBe('different-source');
  });

  it('records a comparison once, immutably, and finds it again', async () => {
    const history = await openHistory();
    const { a, bFailed } = await accumulate(history);
    await history.compare(a, bFailed, { claims: [claim], record: true });
    await history.compare(a, bFailed, { claims: [claim], record: true });
    expect((await history.index()).deltas).toHaveLength(1);
  });

  it('never promotes an observed run to an accepted expectation', async () => {
    const history = await openHistory();
    const { a } = await accumulate(history);
    const detail = await history.execution(a);
    expect(defined(detail).envelope.expectations).toEqual({
      declaredInTest: [],
    });
    expect(JSON.stringify(await history.index())).not.toMatch(
      /accepted-baseline|baselineAccepted/u,
    );
  });
});

describe('tree identity', () => {
  it('does not call a dirty working tree a tree that was seen before', async () => {
    const history = await openHistory();
    await ingest(
      history,
      execution({ attemptId: 'p', commit: 'c1', tree: 't1', capturedAt: at(10) }),
    );
    await ingest(
      history,
      execution({ attemptId: 'q', commit: 'c2', tree: 't1', capturedAt: at(20), dirty: true }),
    );
    await ingest(
      history,
      execution({ attemptId: 'r', commit: 'c3', tree: 't1', capturedAt: at(30) }),
    );
    const entries = await history.behaviorHistory(id, { followAliases: false });
    expect(
      entries.map(
        ({ attemptId, treeSeenBefore }) => `${String(attemptId)}:${String(treeSeenBefore)}`,
      ),
    ).toEqual(['p:false', 'q:false', 'r:true']);
  });
});

describe('findings', () => {
  it('collects failed attempts, failed assertions and refuted comparisons with links to their records', async () => {
    const history = await openHistory();
    const { a, bFailed } = await accumulate(history);
    await history.compare(a, bFailed, { claims: [claim], record: true });
    const findings = await history.findings(id, { followAliases: false });
    expect(
      findings.attempts.map(({ attemptId, kind }) => `${attemptId ?? 'none'}:${kind}`).sort(),
    ).toEqual(['b0:execution', 'b1:execution', 'none:attempt-without-evidence']);
    expect(findings.comparisons).toEqual([
      expect.objectContaining({ refutedClaims: ['one-payment'] }),
    ]);
    expect(goodSpans).toBeDefined();
  });

  it('reports failed and inconclusive assertions but not passed ones', async () => {
    const history = await openHistory();
    await ingest(
      history,
      execution({
        attemptId: 'x',
        assertions: [
          { outcome: 'failed', evaluation: 'unsatisfied' },
          { outcome: 'inconclusive', evaluation: 'undetermined' },
          { outcome: 'passed', evaluation: 'satisfied' },
        ],
      }),
    );
    const findings = await history.findings(id, { followAliases: false });
    expect(findings.assertions.map(({ outcome }) => outcome)).toEqual(['failed', 'inconclusive']);
  });
});
