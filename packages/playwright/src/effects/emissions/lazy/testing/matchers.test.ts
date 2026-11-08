import { expect as check, it } from 'vitest';
import { expect } from '../../../expect.js';
import { completeGraph, emission } from '../../../testing/emissions.fixture.js';
import { serializeEffectSnapshot } from '../../snapshot.js';
import { providerFixture } from './provider.fixture.js';

const open = (effects: Parameters<typeof completeGraph>[0]) => {
  const graph = completeGraph(effects);
  return { ...graph, scope: { ...graph.scope, closed: false } };
};
const boundedExpect = expect.configure({ timeout: 120 });

it('constructs without I/O, rereads delayed observations and reports only the terminal immutable cut', async () => {
  const fixture = providerFixture((read) => open(read === 1 ? [] : [emission('arrived')]));
  const selected = fixture.facade.http({ method: 'POST' });
  check(fixture.reads()).toBe(0);
  check(selected).not.toHaveProperty('emissions');
  await boundedExpect(selected).toHaveEmittedWith({ target: '/payments' });
  check(fixture.reads()).toBe(2);
  check(fixture.reports).toHaveLength(1);
  check(fixture.retained).toEqual([fixture.observed[1]]);
  check(fixture.reports[0].assessment.identity).toEqual(fixture.observed[1].identity);
  check(fixture.reports[0].witnesses.map(({ id }) => id)).toEqual(['arrived']);
  check(fixture.observed[0].http().emissions).toEqual([]);
});

it('keeps an explicit capture immutable and snapshots only that frozen cut', async () => {
  const fixture = providerFixture((read) => open(read === 1 ? [] : [emission('arrived')]));
  const frozen = await fixture.facade.capture();
  check(fixture.retained).toEqual([frozen]);
  await boundedExpect(fixture.facade.http()).toHaveEmitted();
  check(frozen.http().emissions).toEqual([]);
  check(serializeEffectSnapshot(frozen.http(), { project: ({ target }) => target })).toContain('"emissions": []');
  // A copied or cast lazy handle cannot become an authenticated frozen recorder.
  // @ts-expect-error Lazy selections cannot be serialized as frozen observation cuts.
  check(() => serializeEffectSnapshot(fixture.facade.http(), { project: () => null })).toThrow(/not an effect recorder/);
});

it('times out inconclusively for empty open cuts under both polarities', async () => {
  for (const negated of [false, true]) {
    const fixture = providerFixture(() => open([]));
    const started = performance.now();
    const assertion = boundedExpect(fixture.facade.http());
    await check((negated ? assertion.not : assertion).toHaveEmitted()).rejects.toThrow(/inconclusive/);
    check(performance.now() - started).toBeLessThan(1_000);
    check(fixture.reads()).toBeGreaterThan(1);
    check(fixture.reports).toHaveLength(1);
    check(fixture.reports[0].assessment.status).toBe('inconclusive');
  }
});

it('keeps the last inconclusive cut instead of starting a read with a tiny remaining budget', async () => {
  const fixture = providerFixture((read, timeoutMs) => {
    if (read > 1 && timeoutMs < 50) { throw new Error('Collector refuses a tiny final capture budget'); }
    return open([]);
  });
  await check(boundedExpect(fixture.facade.http()).toHaveEmitted()).rejects.toThrow(/inconclusive/);
  check(fixture.reads()).toBeGreaterThan(1);
  check(fixture.budgets.slice(1).every((timeoutMs) => timeoutMs >= 50)).toBe(true);
  check(fixture.reports).toHaveLength(1);
  check(fixture.retained).toEqual([fixture.observed.at(-1)]);
  check(fixture.reports[0].assessment.status).toBe('inconclusive');
});

it('immediately refutes absence and excess exact counts but does not certify an open exact count', async () => {
  const present = providerFixture(() => open([emission('one')]));
  await check(boundedExpect(present.facade.http()).not.toHaveEmitted()).rejects.toThrow(/Expected selected effects not/);
  check(present.reads()).toBe(1);
  const excess = providerFixture(() => open([emission('one'), emission('two')]));
  await check(boundedExpect(excess.facade.http()).toHaveEmittedTimes(1)).rejects.toThrow(/fail/);
  check(excess.reads()).toBe(1);
  await check(boundedExpect(present.facade.http()).toHaveEmittedTimes(1)).rejects.toThrow(/inconclusive/);
});

it('resolves ordering operands from one cut and preserves causal ordinal evidence', async () => {
  const graph = { ...completeGraph([emission('second', '/retained'), emission('first', '/created')]),
    relations: [{ type: 'happensBefore' as const, from: 'first', to: 'second', evidence: 'controlled-causal-edge' }] };
  const fixture = providerFixture(() => graph);
  await boundedExpect(fixture.facade.http({ route: '/created' })).toHaveEmittedBefore(fixture.facade.http({ route: '/retained' }));
  check(fixture.reads()).toBe(1);
  check(fixture.reports[0].otherCapture).toEqual(fixture.reports[0].assessment.identity);
  await boundedExpect(fixture.facade.http()).toHaveNthEmittedWith(2, { target: '/retained' });
});

it('rejects mixed and foreign selections before reading, and copied or expired handles cannot pass', async () => {
  const first = providerFixture(() => completeGraph([emission('one')]));
  const second = providerFixture(() => completeGraph([emission('two')]));
  await check(boundedExpect(first.facade.http()).toHaveEmittedBefore(second.facade.http())).rejects.toThrow(/same stimulus/);
  check(first.reads()).toBe(0);
  check(second.reads()).toBe(0);
  const frozen = await first.facade.capture();
  await check(boundedExpect(first.facade.http()).toHaveEmittedBefore(frozen.http())).rejects.toThrow(/same stimulus/);
  await check(boundedExpect(frozen.http()).toHaveEmittedBefore(first.facade.http())).rejects.toThrow(/frozen capture/);
  await check(boundedExpect({ ...first.facade.http() }).toHaveEmitted()).rejects.toThrow(/not an effect recorder/);
  first.close();
  await check(boundedExpect(first.facade.http()).not.toHaveEmitted()).rejects.toThrow(/Attempt ended/);
  await check(first.facade.capture()).rejects.toThrow(/Attempt ended/);
});

it('stops retries after close and never reports a late cut', async () => {
  const fixture = providerFixture(() => { fixture.close(); return open([]); });
  await check(boundedExpect(fixture.facade.http()).toHaveEmitted()).rejects.toThrow(/Attempt ended/);
  check(fixture.reads()).toBe(1);
  check(fixture.reports).toEqual([]);
  check(fixture.retained).toEqual([]);
});
