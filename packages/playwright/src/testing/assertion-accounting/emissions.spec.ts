import { expect as check } from '@playwright/test';
import type { EffectRecorder } from '@suites/blackbox-effects';

import { assertionScope, expect, serializeEffectSnapshot, test } from '../../index.js';
import { completeGraph, emission, recordedEffects } from '../../effects/testing/emissions.fixture.js';
import { bindEffectAssertionReporter } from '../../effects/runtime.js';
import { AttemptReport } from '../../reporting/attempt.js';
import { record } from './evidence.fixture.js';

let retained: EffectRecorder;

test('emission matchers count once despite rejected earlier candidates and negated payloads', async () => {
  const effects = recordedEffects(completeGraph([emission('1', '/declined'), emission('2')]));
  const reporter = new AttemptReport(test.info());
  reporter.protect({ token: 'declined' });
  bindEffectAssertionReporter(effects, reporter);
  const selected = (await effects.capture()).http();
  retained = selected;
  const result = await assertionScope(async () => {
    await expect(selected).toHaveEmitted();
    await expect(selected).toHaveEmittedTimes(2);
    await expect(selected).toHaveEmittedWith({ target: expect.stringContaining('payments') });
    await expect(selected).not.toHaveEmittedWith({ target: '/missing' });
  });
  check(result.accounting).toEqual({ total: 4, passed: 4, failed: 0, pending: 0, unconsumed: 0 });
  record('emission-accounting', result.accounting);
});

test('a recorder cannot supply evidence to a subsequent native test attempt', async () => {
  await check(expect(retained).toHaveEmitted()).rejects.toThrow(/another Playwright attempt/);
  await check(expect(retained).not.toHaveEmitted()).rejects.toThrow(/another Playwright attempt/);
  check(() => serializeEffectSnapshot(retained, { project: () => null })).toThrow(/another Playwright attempt/);
  record('foreign-emission-rejected', retained.identity);
});

test('a caught outer emission failure still rejects its assertion scope', async () => {
  const selected = (await recordedEffects(completeGraph([emission('1')])).capture()).http();
  let error: unknown;
  try {
    await assertionScope(async () => {
      try { await expect(selected).toHaveEmittedWith({ target: '/wrong' }); }
      catch { /* Deliberately swallowed to challenge the outer accounting oracle. */ }
    });
  } catch (caught) { error = caught; }
  check(error).toMatchObject({ code: 'failed', accounting: { total: 1, passed: 0, failed: 1, pending: 0, unconsumed: 0 } });
  record('emission-caught-rejected', error);
});

test('causal and ordinal emission assertions retain one native count each', async () => {
  const graph = { ...completeGraph([emission('2', '/retained'), emission('1', '/created')]),
    relations: [{ type: 'happensBefore' as const, from: '1', to: '2', evidence: 'controlled-causal-edge' }] };
  const capture = await recordedEffects(graph).capture();
  const result = await assertionScope(async () => {
    await expect(capture.http({ route: '/created' })).toHaveEmittedBefore(capture.http({ route: '/retained' }));
    await expect(capture.http()).toHaveNthEmittedWith(2, { target: expect.stringContaining('retained') });
  });
  check(result.accounting).toEqual({ total: 2, passed: 2, failed: 0, pending: 0, unconsumed: 0 });
  record('emission-order-accounting', result.accounting);
});

test('reviewed observed-effect YAML uses the native snapshot matcher and accounting', async () => {
  const recorder = (await recordedEffects(completeGraph([emission('1')])).capture()).http();
  const yaml = serializeEffectSnapshot(recorder, { project: ({ operation, target }) => ({ operation, target }) });
  const result = await assertionScope(() => { expect(yaml).toMatchSnapshot('emissions.yaml'); });
  check(result.accounting).toEqual({ total: 1, passed: 1, failed: 0, pending: 0, unconsumed: 0 });
  record('emission-snapshot-accounting', result.accounting);
});
