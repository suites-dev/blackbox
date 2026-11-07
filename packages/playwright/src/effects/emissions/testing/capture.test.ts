import { expect as check, it } from 'vitest';

import { createAttemptEffects } from '../../attempt-effects.js';
import { expect } from '../../expect.js';
import { createBlackboxEffects } from '../../runtime.js';
import { attribute, payload, span } from '../../testing/observations.fixture.js';
import { captureEffectObservations } from '../capture.js';
import { serializeEffectSnapshot } from '../snapshot.js';

const identity = { sessionId: 'session', executionId: 'attempt', scopeId: 'scope', activityIds: ['stimulus'] };

it('captures exactly one admitted read and retains the original cut as later observations arrive', async () => {
  const spans = [span(1, { attributes: [attribute('http.request.method', 'POST'), attribute('http.route', '/payments')] })];
  let reads = 0;
  const source = { read: () => {
    reads++;
    return Promise.resolve({ kind: 'admitted' as const, scopeId: 'scope', payloads: [payload(spans)], diagnostics: [] });
  } };
  const first = await captureEffectObservations({ identity, source });
  check(reads).toBe(1);
  check(first.capture.http().emissions).toHaveLength(1);
  spans.push(span(2, { attributes: [attribute('http.request.method', 'POST'), attribute('http.route', '/other')] }));
  const second = await captureEffectObservations({ identity, source });
  check(reads).toBe(2);
  check(first.capture.http().emissions).toHaveLength(1);
  check(second.capture.http().emissions).toHaveLength(2);
  check(first.capture.identity.captureId).not.toBe(second.capture.identity.captureId);
  check(first.evidence).toMatchObject({ observations: { payloadCount: 1 }, projection: { effects: [{ target: '/payments' }] } });
});

it('retains unavailability or rejection without inventing an empty observed graph', async () => {
  for (const kind of ['unavailable', 'rejected'] as const) {
    const captured = await captureEffectObservations({ identity,
      source: { read: () => Promise.resolve({ kind, message: `source ${kind}` }) } });
    check(captured.capture.available).toBe(false);
    check(captured.capture.unavailableReason).toBe(`source ${kind}`);
    check(captured.evidence).toBeNull();
  }
});

it('does not infer observations before any stimulus or snapshot unavailable evidence', async () => {
  const { effects } = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory: '/unused' });
  const capture = await effects.capture();
  check(capture.available).toBe(false);
  await check(expect(capture.db()).not.toHaveEmitted()).rejects.toThrow(/inconclusive.*No completed stimulus/);
  check(() => serializeEffectSnapshot(capture.db(), { project: () => null })).toThrow(/Cannot snapshot unavailable/);
  const unavailable = createBlackboxEffects({ sessionId: 'session', executionId: 'attempt',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) } });
  check((await unavailable.capture()).available).toBe(false);
});
