import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { healthy, rawSide, span, type SideSpec } from '../compare/compare.fixture.js';
import { digestBytes, type Digest } from '../envelope/canonical.js';
import type { BehaviorIdentity } from '../envelope/types.js';
import { BehaviorHistory } from './history.js';
import { ReceiptRecorder } from './recorder.js';
import type { AttemptReceipt } from './receipt.js';

export const roots: string[] = [];

export async function openHistory(): Promise<BehaviorHistory> {
  const root = await mkdtemp(join(tmpdir(), 'bb-history-'));
  roots.push(root);
  return BehaviorHistory.open(root);
}

export async function cleanup(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export const behaviorOf = (
  id: string,
  derivedId = 'derived:aaaaaaaaaaaaaaaa',
): BehaviorIdentity => ({
  id,
  basis: id.startsWith('derived:') ? 'derived' : 'declared',
  derivedId,
  declaration: { state: id.startsWith('derived:') ? 'absent' : 'declared' },
});

const payment = (spans: number) => span({ actor: 'payment', operation: 'POST', spans });
export const goodSpans = [...healthy, payment(1)];
export const doubleSpans = [...healthy, payment(2)];

export function execution(overrides: Partial<SideSpec>) {
  return rawSide({
    behavior: behaviorOf('subscription.payment'),
    spans: goodSpans,
    state: [{ subject: 'payment-intents', identities: ['pi_1'] }],
    ...overrides,
  });
}

/** A receipt for an attempt that never reached a sandbox. */
export function failedAcquisition(behavior: BehaviorIdentity, at: number): AttemptReceipt {
  const recorder = new ReceiptRecorder(
    {
      receiptId: `receipt-${String(at)}`,
      retry: 0,
      retries: 1,
      workerIndex: 0,
      parallelIndex: 0,
      test: { runnerTestId: 'runner', file: 'a.spec.ts', titlePath: ['Scenario'], project: '' },
      catalogEntryId: 'system',
      invocation: null,
    },
    () => `2026-01-01T00:00:${String(at).padStart(2, '0')}.000Z`,
  );
  recorder.acquisitionFailed('acquisition', 'sandbox did not start');
  return recorder.build({
    behavior,
    outcome: { testStatus: 'failed', expectedStatus: 'passed', errorCount: 1 },
    interrupted: false,
    envelope: null,
  });
}

export const claim = {
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
};

export async function ingest(
  history: BehaviorHistory,
  spec: ReturnType<typeof execution>,
): Promise<Digest> {
  const { id } = await history.ingestEnvelope(spec.envelope, spec.body);
  return id;
}

export { digestBytes };

/** Narrows a value a test has just proven exists, so a missing one fails loudly instead of being skipped. */
export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

/** A receipt for an attempt that ran in a sandbox and says its envelope is `envelope`. */
export function completedReceipt(envelope: Digest, at: number): AttemptReceipt {
  const recorder = new ReceiptRecorder(
    {
      receiptId: `receipt-${String(at)}`,
      retry: 0,
      retries: 1,
      workerIndex: 0,
      parallelIndex: 0,
      test: { runnerTestId: 'runner', file: 'a.spec.ts', titlePath: ['Scenario'], project: '' },
      catalogEntryId: 'system',
      invocation: null,
    },
    () => `2026-01-01T00:00:${String(at).padStart(2, '0')}.000Z`,
  );
  recorder.started(`sandbox-${String(at)}`);
  return recorder.build({
    behavior: behaviorOf('subscription.payment'),
    outcome: { testStatus: 'passed', expectedStatus: 'passed', errorCount: 0 },
    interrupted: false,
    envelope,
  });
}
