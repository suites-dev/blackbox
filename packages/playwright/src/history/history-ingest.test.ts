import { afterEach, describe, expect, it } from 'vitest';

import { buildEnvelope } from '../envelope/build.js';
import { inputFixture } from '../envelope/envelope.fixture.js';
import { HistoryError } from './history.js';
import {
  cleanup,
  completedReceipt,
  defined,
  execution,
  failedAcquisition,
  ingest,
  behaviorOf,
  openHistory,
} from './history.fixture.js';

afterEach(cleanup);

describe('ingesting immutable records', () => {
  it('stores an envelope and its snapshot, and ingesting the same record again changes nothing', async () => {
    const history = await openHistory();
    const spec = execution({});
    const first = await history.ingestEnvelope(spec.envelope, spec.body);
    const second = await history.ingestEnvelope(spec.envelope, spec.body);
    expect(first).toEqual({ id: spec.envelope.digest, created: true });
    expect(second).toEqual({ id: spec.envelope.digest, created: false });
    const index = await history.index();
    expect(index.executions).toHaveLength(1);
    expect(index.blobs).toHaveLength(1);
    expect(index.executions[0].snapshot).toBe('stored');
  });

  it('refuses an envelope that does not verify, or a snapshot the envelope does not reference', async () => {
    const history = await openHistory();
    const spec = execution({});
    const tampered = { ...spec.envelope, source: { ...spec.envelope.source, commit: 'other' } };
    await expect(history.ingestEnvelope(tampered, spec.body)).rejects.toBeInstanceOf(HistoryError);
    await expect(history.ingestEnvelope(spec.envelope, `${spec.body} `)).rejects.toBeInstanceOf(
      HistoryError,
    );
    expect((await history.index()).executions).toHaveLength(0);
  });

  it('keeps an envelope whose snapshot is unavailable and says so, instead of dropping it', async () => {
    const history = await openHistory();
    const spec = execution({});
    await history.ingestEnvelope(spec.envelope, null);
    expect((await history.index()).executions[0].snapshot).toBe('missing');
    const detail = await history.execution(spec.envelope.digest);
    expect(defined(detail).snapshotBody).toBeNull();
  });

  it('stores a receipt for an attempt with no envelope and fabricates no behavioral record for it', async () => {
    const history = await openHistory();
    await history.ingestReceipt(failedAcquisition(behaviorOf('subscription.payment'), 5));
    const index = await history.index();
    expect(index.executions).toEqual([]);
    expect(index.receipts).toHaveLength(1);
    expect(index.receipts[0]).toMatchObject({
      status: 'acquisition-failed',
      envelope: null,
      envelopeStored: false,
    });
  });

  it('says when a receipt points at an envelope the history does not hold', async () => {
    const history = await openHistory();
    const stored = execution({ attemptId: 'a' });
    const missing = execution({ attemptId: 'b' });
    await ingest(history, stored);
    await history.ingestReceipt(completedReceipt(stored.envelope.digest, 1));
    await history.ingestReceipt(completedReceipt(missing.envelope.digest, 2));
    const receipts = (await history.index()).receipts;
    expect(
      receipts
        .map(({ receiptId, envelopeStored }) => `${receiptId}:${String(envelopeStored)}`)
        .sort(),
    ).toEqual(['receipt-1:true', 'receipt-2:false']);
  });

  it('refuses a receipt that breaks its own invariants', async () => {
    const history = await openHistory();
    const receipt = failedAcquisition(behaviorOf('x'), 5);
    await expect(
      history.ingestReceipt({ ...receipt, invocation: 'tampered' }),
    ).rejects.toBeInstanceOf(HistoryError);
  });

  it('is unaffected by ingesting many distinct executions at once', async () => {
    const history = await openHistory();
    const specs = Array.from({ length: 12 }, (_, index) =>
      execution({ attemptId: `attempt-${String(index)}` }),
    );
    await Promise.all(specs.map((spec) => history.ingestEnvelope(spec.envelope, spec.body)));
    expect((await history.index()).executions).toHaveLength(12);
    const unchanged = buildEnvelope(inputFixture());
    expect(unchanged.digest).toBeDefined();
  });
});
