import { describe, expect, it } from 'vitest';

import { buildReceipt, receiptStatus, verifyReceipt, type AttemptReceipt } from './receipt.js';
import { ReceiptRecorder, type ReceiptContext } from './recorder.js';
import { digestBytes } from '../../envelope/canonical.js';
import { defined } from '../testing/history.fixture.js';

const context = {
  receiptId: 'r-1',
  retry: 0,
  retries: 1,
  workerIndex: 0,
  parallelIndex: 0,
  test: { runnerTestId: 'runner', file: 'a.spec.ts', titlePath: ['Scenario'], project: '' },
  catalogEntryId: 'system',
  invocation: 'invocation:abc',
} satisfies ReceiptContext;
const behavior = {
  id: 'derived:aaaaaaaaaaaaaaaa',
  basis: 'derived' as const,
  derivedId: 'derived:aaaaaaaaaaaaaaaa',
  declaration: { state: 'absent' as const },
};
let tick = 0;
const clock = () => `2026-01-01T00:00:${String(10 + (tick += 1)).padStart(2, '0')}.000Z`;
const outcome = { testStatus: 'passed', expectedStatus: 'passed', errorCount: 0 };
const envelope = digestBytes('envelope');

describe('attempt receipts', () => {
  it('records an attempt that failed before a sandbox existed, with no sandbox and no envelope', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.acquisitionFailed('catalog', 'ENOENT: compose file missing');
    const receipt = recorder.build({
      behavior,
      outcome: { ...outcome, testStatus: 'failed', errorCount: 1 },
      interrupted: false,
      envelope: null,
    });
    expect(receipt.lifecycle.map(({ state }) => state)).toEqual([
      'scheduled',
      'acquisition-failed',
    ]);
    expect(receipt.attempt.sandboxId).toBeNull();
    expect(receipt.envelope).toBeNull();
    expect(receipt.failure).toEqual({ phase: 'catalog', message: 'ENOENT: compose file missing' });
    expect(receiptStatus(receipt)).toBe('acquisition-failed');
    expect(verifyReceipt(receipt)).toEqual({ ok: true, problems: [] });
    expect(JSON.stringify(receipt)).not.toContain('effects');
  });

  it('records a completed attempt that produced an envelope', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.started('sandbox-1');
    const receipt = recorder.build({ behavior, outcome, interrupted: false, envelope });
    expect(receipt.lifecycle.map(({ state }) => state)).toEqual([
      'scheduled',
      'execution-started',
      'execution-completed',
    ]);
    expect(receiptStatus(receipt)).toBe('completed');
    expect(receipt.envelope).toBe(envelope);
  });

  it('marks evidence as unavailable instead of pointing at nothing', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.started('sandbox-1');
    const receipt = recorder.build({ behavior, outcome, interrupted: false, envelope: null });
    expect(receipt.lifecycle.map(({ state }) => state)).toEqual([
      'scheduled',
      'execution-started',
      'execution-completed',
      'evidence-unavailable',
    ]);
    expect(receiptStatus(receipt)).toBe('completed-without-evidence');
  });

  it('distinguishes an interrupted execution', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.started('sandbox-1');
    const receipt = recorder.build({
      behavior,
      outcome: { ...outcome, testStatus: 'interrupted' },
      interrupted: true,
      envelope,
    });
    expect(receiptStatus(receipt)).toBe('interrupted');
  });

  it('truncates a failure message and keeps the invocation for retry lineage', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.acquisitionFailed('acquisition', 'x'.repeat(1000));
    const receipt = recorder.build({ behavior, outcome, interrupted: false, envelope: null });
    expect(defined(receipt.failure).message).toHaveLength(300);
    expect(receipt.invocation).toBe('invocation:abc');
  });
});

describe('receipt invariants', () => {
  const base = (): AttemptReceipt =>
    new ReceiptRecorder(context, clock).build({
      behavior,
      outcome,
      interrupted: false,
      envelope: null,
    });
  const rebuild = (patch: (receipt: AttemptReceipt) => object) => {
    const { digest: _digest, ...rest } = base();
    return buildReceipt({ ...rest, ...patch(base()) });
  };

  it('rejects a lifecycle that does not start as scheduled', () => {
    const receipt = rebuild((r) => ({ lifecycle: r.lifecycle.slice(1) }));
    expect(verifyReceipt(receipt).ok).toBe(false);
  });

  it('rejects an acquisition failure that claims a sandbox or an envelope', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.acquisitionFailed('catalog', 'x');
    const good = recorder.build({ behavior, outcome, interrupted: false, envelope: null });
    const { digest: _digest, ...rest } = good;
    expect(verifyReceipt(buildReceipt({ ...rest, envelope }))).toMatchObject({ ok: false });
    expect(
      verifyReceipt(buildReceipt({ ...rest, attempt: { ...rest.attempt, sandboxId: 's' } })),
    ).toMatchObject({ ok: false });
  });

  it('rejects evidence marked unavailable that still points at an envelope', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.started('sandbox-1');
    const good = recorder.build({ behavior, outcome, interrupted: false, envelope: null });
    const { digest: _digest, ...rest } = good;
    expect(verifyReceipt(buildReceipt({ ...rest, envelope }))).toMatchObject({ ok: false });
  });

  it('rejects a lifecycle with more than one ending', () => {
    const recorder = new ReceiptRecorder(context, clock);
    recorder.started('sandbox-1');
    const good = recorder.build({ behavior, outcome, interrupted: false, envelope });
    const { digest: _digest, ...rest } = good;
    const lifecycle = [
      ...rest.lifecycle,
      { state: 'execution-interrupted' as const, at: clock(), detail: '' },
    ];
    expect(verifyReceipt(buildReceipt({ ...rest, lifecycle }))).toMatchObject({
      ok: false,
      problems: ['lifecycle has more than one ending'],
    });
  });

  it('detects a changed receipt', () => {
    const receipt = base();
    expect(verifyReceipt({ ...receipt, invocation: 'invocation:other' }).ok).toBe(false);
  });
});
