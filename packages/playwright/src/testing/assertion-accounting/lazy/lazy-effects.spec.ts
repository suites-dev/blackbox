import { expect as nativeExpect } from '@playwright/test';
import { expect, assertionScope } from '../../../index.js';
import type { LazyEffectRecorder } from '../../../effects/emissions/lazy/types.js';
import { record } from '../evidence.fixture.js';
import { test, fixtureFor, useProject } from './runtime.fixture.js';
import { observeReads } from './reads.fixture.js';

let retained: LazyEffectRecorder | undefined;
test.describe('native lazy effect evidence', () => {
  useProject();
  test('lazy effects wait for delayed OTLP and retain the terminal cut', async ({ stimulus, sandbox }) => {
    const fixture = fixtureFor(sandbox.executionId);
    const outcome = await stimulus('When a payment returns before telemetry export', ({ request, headers }) =>
      request.post(`${fixture.url}/payments`, { headers }));
    nativeExpect(outcome.result.status()).toBe(201);
    nativeExpect(fixture.exported()).toBe(0);
    const effects = outcome.evidence.effects;
    if (effects === undefined) { throw new Error('Missing stimulus effects'); }
    const frozen = await effects.capture();
    nativeExpect(frozen.http().emissions).toEqual([]);
    const observed = observeReads(effects.http());
    const selected = effects.http({ method: 'POST', route: '/payments' });
    retained = selected;
    nativeExpect(selected).toMatchObject({ kind: 'lazy-effect-selection' });
    nativeExpect(selected).not.toHaveProperty('then');
    nativeExpect(selected).not.toHaveProperty('emissions');
    nativeExpect(observed.started()).toBe(0);
    nativeExpect(observed.cuts).toEqual([]);
    let settled = false;
    const checking = assertionScope(() => outcome.verify('Then delayed payment telemetry is observed', async () => {
      await expect(selected).toHaveEmittedWith({ operation: 'POST', target: '/payments' });
    }));
    void checking.then(() => { settled = true; }, () => { settled = true; });
    try {
      const first = await Promise.race([observed.first, checking.then(() => { throw new Error('Verification completed without a collector read'); })]);
      nativeExpect(first.http().emissions).toEqual([]);
      nativeExpect(settled).toBe(false);
      nativeExpect(fixture.exported()).toBe(0);
      await fixture.exportRequest(0);
      const checked = await checking;
      nativeExpect(observed.cuts.length).toBeGreaterThan(1);
      nativeExpect(checked.accounting).toEqual({ total: 1, passed: 1, failed: 0, pending: 0, unconsumed: 0 });
      nativeExpect(first.http().emissions).toEqual([]);
      nativeExpect(frozen.http().emissions).toEqual([]);
      record('lazy-delayed-proof', { explicitCaptureId: frozen.identity.captureId,
        matcherCaptureIds: observed.cuts.map(({ identity }) => identity.captureId),
        activityIds: frozen.identity.activityIds, executionId: sandbox.executionId, accounting: checked.accounting,
        traceId: fixture.requests[0].traceId, spanId: fixture.requests[0].spanId, exported: fixture.exported(), status: outcome.result.status() });
    } finally { observed.restore(); }
  });

  test('later stimulus telemetry cannot satisfy an earlier lazy handle', async ({ stimulus, sandbox }) => {
    const fixture = fixtureFor(sandbox.executionId);
    if (retained === undefined) { throw new Error('Missing preceding attempt handle'); }
    const foreignReads = observeReads(retained);
    try {
      await nativeExpect(expect(retained).toHaveEmitted()).rejects.toThrow(/another Playwright attempt/);
      nativeExpect(foreignReads.started()).toBe(0);
      nativeExpect(foreignReads.cuts).toEqual([]);
    } finally { foreignReads.restore(); }
    const first = await stimulus('When the first payment has no exported trace', ({ request, headers }) => request.post(`${fixture.url}/payments`, { headers }));
    const second = await stimulus('When only the second payment exports its trace', ({ request, headers }) => request.post(`${fixture.url}/payments`, { headers }));
    const firstEffects = first.evidence.effects;
    const secondEffects = second.evidence.effects;
    if (firstEffects === undefined || secondEffects === undefined) { throw new Error('Missing stimulus effects'); }
    const firstHandle = firstEffects.http({ route: '/payments' });
    const observed = observeReads(firstHandle);
    try {
      await fixture.exportRequest(1);
      const started = performance.now();
      await nativeExpect(first.verify('Then a different stimulus remains inconclusive', async () => {
        await expect.configure({ timeout: 150 })(firstHandle).toHaveEmitted();
      })).rejects.toThrow(/inconclusive/);
      nativeExpect(performance.now() - started).toBeLessThan(2_000);
      nativeExpect(observed.cuts.length).toBeGreaterThan(1);
      nativeExpect(observed.cuts.every((cut) => cut.http().emissions.length === 0)).toBe(true);
      await second.verify('Then the second stimulus owns its emitted payment', async () => {
        await expect(secondEffects.http({ route: '/payments' })).toHaveEmitted();
      });
      record('lazy-isolation-proof', { firstCaptureIds: observed.cuts.map(({ identity }) => identity.captureId),
        firstActivityIds: observed.cuts[0].identity.activityIds, traceIds: fixture.requests.map(({ traceId }) => traceId),
        executionId: sandbox.executionId, exported: fixture.exported(), foreignReads: foreignReads.started() });
    } finally { observed.restore(); }
  });
});
