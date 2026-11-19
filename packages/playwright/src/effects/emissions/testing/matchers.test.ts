import { expect as check, it } from 'vitest';

import { expect } from '../../expect.js';
import { bindEffectAssertionReporter, closeBlackboxEffects } from '../../runtime.js';
import { completeGraph, emission, recordedEffects } from '../../testing/emissions.fixture.js';
import type { EmissionAssertionReport } from '../types.js';
import { serializeEffectSnapshot } from '../snapshot.js';

it('matches observed scalar facts with native asymmetric leaves and records each verdict', async () => {
  const effects = recordedEffects(completeGraph([emission('1', '/declined'), emission('2')]));
  const reports: EmissionAssertionReport[] = [];
  bindEffectAssertionReporter(effects, {
    effectAssertion: () => Promise.resolve(),
    emissionAssertion: (report) => { reports.push(report); return Promise.resolve(); },
  });
  const selected = (await effects.capture()).http();
  await expect(selected).toHaveEmitted();
  await expect(selected).toHaveEmittedTimes(2);
  await expect(selected).toHaveEmittedWith({ target: expect.stringContaining('payments'), actor: expect.any(String), attributes: { 'http.status': 201 } });
  await expect(selected).not.toHaveEmittedWith({ target: '/missing' });
  check(reports.map(({ assessment }) => assessment.status)).toEqual(['pass', 'pass', 'pass', 'fail']);
  check(reports[2].assessment.evidence).toEqual(['2']);
  check(reports[2].assessment.identity).toEqual(selected.identity);
});

it('rejects wrong payload and multiplicity while preserving definite negation', async () => {
  const selected = (await recordedEffects(completeGraph([emission('1'), emission('2')])).capture()).http();
  await check(expect(selected).toHaveEmittedTimes(1)).rejects.toThrow(/fail/);
  await check(expect(selected).toHaveEmittedWith({ target: '/wrong' })).rejects.toThrow(/fail/);
  await expect(selected).not.toHaveEmittedTimes(1);
  await expect(selected).not.toHaveEmittedWith({ target: '/wrong' });
});

it('does not turn incomplete counts or unknown facts into passes under either polarity', async () => {
  const graph = completeGraph([{ ...emission('1'), outcome: 'unknown' }]);
  const selected = (await recordedEffects({ ...graph, scope: { ...graph.scope, closed: false } }).capture()).http();
  await expect(selected).toHaveEmitted();
  await check(expect(selected).not.toHaveEmittedTimes(1)).rejects.toThrow(/inconclusive/);
  await check(expect(selected).toHaveEmittedTimes(1)).rejects.toThrow(/inconclusive/);
  await check(expect(selected).toHaveEmittedWith({ outcome: expect.any(String) })).rejects.toThrow(/inconclusive/);
  await check(expect(selected).not.toHaveEmittedWith({ outcome: expect.not.stringContaining('failed') })).rejects.toThrow(/inconclusive/);
});

it('freezes a capture even when a later source cut adds an occurrence', async () => {
  const occurrences = [emission('1')];
  const effects = recordedEffects(completeGraph(occurrences));
  const first = await effects.capture();
  const original = first.http();
  occurrences.push(emission('2'));
  const second = await effects.capture();
  await expect(original).toHaveEmittedTimes(1);
  await expect(second.http()).toHaveEmittedTimes(2);
  check(first.identity.captureId).not.toEqual(second.identity.captureId);
  check(Object.isFrozen(original.emissions)).toBe(true);
});

it('rejects forged and expired recorders even under negation', async () => {
  const effects = recordedEffects(completeGraph([emission('1')]));
  const recorder = (await effects.capture()).http();
  await check(expect({ ...recorder }).not.toHaveEmitted()).rejects.toThrow(/not an effect recorder owned/);
  check(() => serializeEffectSnapshot({ ...recorder }, { project: () => null })).toThrow(/not an effect recorder owned/);
  closeBlackboxEffects(effects);
  await check(expect(recorder).toHaveEmitted()).rejects.toThrow(/inconclusive.*attempt ended/);
  await check(expect(recorder).not.toHaveEmitted()).rejects.toThrow(/inconclusive.*attempt ended/);
  check(() => serializeEffectSnapshot(recorder, { project: () => null })).toThrow(/attempt ended/);
});

it('rejects unsupported payload shapes and preserves asymmetric matcher exceptions', async () => {
  const recorder = (await recordedEffects(completeGraph([emission('1')])).capture()).http();
  await check(expect(recorder).toHaveEmittedWith(expect.objectContaining({ target: '/payments' }))).rejects.toThrow(/scalar leaves/);
  await check(expect(recorder).toHaveEmittedWith({})).rejects.toThrow(/non-empty/);
  await check(expect(recorder).toHaveEmittedWith({ target: { asymmetricMatch() { throw new Error('comparator failed'); } } })).rejects.toThrow('comparator failed');
});

it('checks causal before and ordinal matches without treating array position as order', async () => {
  const first = emission('1', '/created');
  const second = emission('2', '/retained');
  const graph = { ...completeGraph([second, first]), relations: [
    { type: 'happensBefore' as const, from: '1', to: '2', evidence: 'controlled-causal-edge' },
  ] };
  const capture = await recordedEffects(graph).capture();
  await expect(capture.http({ route: '/created' })).toHaveEmittedBefore(capture.http({ route: '/retained' }));
  await expect(capture.http()).toHaveNthEmittedWith(1, { target: '/created' });
  await expect(capture.http()).toHaveNthEmittedWith(2, { target: expect.stringContaining('retained') });
  await check(expect(capture.http()).toHaveNthEmittedWith(1, { target: '/retained' })).rejects.toThrow(/fail/);
  const unordered = await recordedEffects(completeGraph([first, second])).capture();
  await check(expect(unordered.http()).toHaveNthEmittedWith(1, { target: '/created' })).rejects.toThrow(/inconclusive/);
  await check(expect(unordered.http()).not.toHaveNthEmittedWith(1, { target: '/created' })).rejects.toThrow(/inconclusive/);
});
