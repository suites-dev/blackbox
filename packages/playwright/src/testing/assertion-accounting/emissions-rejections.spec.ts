import { setImmediate } from 'node:timers/promises';
import { expect as check } from '@playwright/test';

import { assertionScope, expect, serializeEffectSnapshot, test } from '../../index.js';
import { completeGraph, emission, recordedEffects } from '../../effects/testing/emissions.fixture.js';
import { record } from './evidence.fixture.js';

test('soft emission mismatch rejects its scope and native test', async () => {
  const recorder = (await recordedEffects(completeGraph([emission('1')])).capture()).http();
  try {
    await assertionScope(async () => { await expect.soft(recorder).toHaveEmittedWith({ target: '/wrong' }); });
  } catch (error) {
    check(error).toMatchObject({ code: 'failed', accounting: { total: 1, failed: 1 } });
    record('soft-emission-rejected', error);
    throw error;
  }
  throw new Error('Expected a soft emission failure to reject its assertion scope');
});

test('an unconsumed emission matcher cannot satisfy its scope', async () => {
  const recorder = (await recordedEffects(completeGraph([emission('1')])).capture()).http();
  try {
    await assertionScope(async () => {
      void expect(recorder).toHaveEmitted();
      await setImmediate();
    });
  } catch (error) {
    check(error).toMatchObject({ code: 'unconsumed', accounting: { total: 1, unconsumed: 1 } });
    record('unconsumed-emission-rejected', error);
    throw error;
  }
  throw new Error('Expected an unconsumed emission matcher to reject its assertion scope');
});

for (const change of ['multiplicity', 'value', 'missing baseline']) {
  test(`observed-effect YAML rejects ${change}`, async () => {
    const effects = change === 'multiplicity' ? [emission('1'), emission('2')]
      : [emission('1', change === 'value' ? '/changed' : '/payments')];
    const recorder = (await recordedEffects(completeGraph(effects)).capture()).http();
    const yaml = serializeEffectSnapshot(recorder, { project: ({ operation, target }) => ({ operation, target }) });
    try {
      await assertionScope(() => {
        try { expect(yaml).toMatchSnapshot(change === 'missing baseline' ? 'missing-emissions.yaml' : 'emissions.yaml'); }
        catch { /* A swallowed native snapshot failure must still reject the scope. */ }
      });
    } catch (error) {
      check(error).toMatchObject({ code: 'failed', accounting: { total: 1, failed: 1 } });
      record('emission-snapshot-rejected', { change });
      throw error;
    }
    throw new Error('Expected a changed or missing baseline to reject its assertion scope');
  });
}
