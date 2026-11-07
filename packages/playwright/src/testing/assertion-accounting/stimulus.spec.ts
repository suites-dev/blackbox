import { expect as nativeExpect } from '@playwright/test';
import { test, expect } from '../../index.js';
import { completeGraph, recordedEffects } from '../../effects/testing/emissions.fixture.js';
import { createAttemptEffects } from '../../effects/attempt-effects.js';
import { createAttemptStep } from '../../steps/step-context.js';
import { createStateRegistry } from '../../state/registry.js';
import { createStimulusLifecycle } from '../../stimulus/lifecycle/runtime.js';
import type { RunningBlackboxAttempt } from '../../runtime/acquisition.js';
import { record, deferred } from './evidence.fixture.js';

function lifecycle(request: Parameters<typeof createStimulusLifecycle>[0]['request'], storageDirectory: string) {
  const registry = createStateRegistry();
  const effects = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory }).effects;
  const attempt = { sandbox: { executionId: 'attempt' }, telemetry: { sessionId: 'session' }, effects } as RunningBlackboxAttempt;
  const step = createAttemptStep(test.step.bind(test), attempt);
  const run = createStimulusLifecycle({ registry, request, step: step.step });
  return { registry, run, close() { run.close(); step.revoke(); registry.close(); } };
}

test('captures exact initial values and binds sequential verification', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  let rows: { id: string; status: string }[] = [];
  let reads = 0;
  const payments = fixture.registry.state.observe('payments', { rows: () => { reads++; return rows; } });
  const first = await fixture.run.stimulus('When payment is accepted', ({ request: supplied, headers }) => {
    nativeExpect(supplied).toBe(request);
    nativeExpect(headers.traceparent).toMatch(/^00-/);
    rows = [{ id: 'p1', status: 'succeeded' }];
    return 'accepted';
  }, { precondition: { name: 'Given no payments', check: ({ initial }) => { expect(initial(payments).rows).toEqual([]); } } });
  const { evidence, verify, result } = first;
  const firstState = evidence.state(payments);
  nativeExpect(reads).toBe(2);
  const firstId = await verify('Then the returned payment exists', () => {
    expect(result).toBe('accepted');
    expect(firstState.diff.rows.added).toEqual([{ id: 'p1', status: 'succeeded' }]);
    return 'p1';
  });
  const second = await fixture.run.stimulus('When another payment is accepted', () => {
    rows = [...rows, { id: 'p2', status: 'succeeded' }];
  });
  nativeExpect(firstId).toBe('p1');
  nativeExpect(firstState.final.rows).toHaveLength(1);
  nativeExpect(second.evidence.state(payments).diff.rows.added).toEqual([{ id: 'p2', status: 'succeeded' }]);
  const late = fixture.registry.state.observe('late', { value: () => 1 });
  nativeExpect(() => evidence.state(late)).toThrow();
  nativeExpect(reads).toBe(4);
  record('stimulus-events', fixture.run.journal.events().map(({ kind }) => kind));
  fixture.close();
});

test('precondition failures and overlap block the action', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  const observed = fixture.registry.state.observe('payments', { rows: () => [] });
  let calls = 0;
  for (const check of [() => undefined, () => { try { expect(1).toBe(2); } catch { /* deliberate swallow */ } }]) {
    await nativeExpect(fixture.run.stimulus('When blocked', () => { calls++; }, {
      precondition: { name: 'Given blocked', check },
    })).rejects.toThrow();
  }
  const entered = deferred<undefined>();
  const release = deferred<undefined>();
  const first = fixture.run.stimulus('When waiting', async () => { entered.resolve(undefined); await release.promise; calls++; });
  await entered.promise;
  await nativeExpect(fixture.run.stimulus('When overlapping', () => { calls++; })).rejects.toThrow(/Overlapping/);
  release.resolve(undefined);
  const result = await first;
  await nativeExpect(result.verify('Then empty verification', () => undefined)).rejects.toThrow(/empty/);
  nativeExpect(result.evidence.state(observed).initial.rows).toEqual([]);
  nativeExpect(calls).toBe(1);
  const actions = fixture.run.journal.events().filter((event) => event.kind === 'action');
  nativeExpect(actions.map(({ status }) => status)).toEqual(['not-executed', 'not-executed', 'completed']);
  fixture.close();
});

test('capture and action failures preserve only available evidence', async ({ request }, info) => {
  const initialFailure = lifecycle(request, info.outputDir);
  let called = false;
  initialFailure.registry.state.observe('broken', { value: () => { throw new Error('reader failed'); } });
  await nativeExpect(initialFailure.run.stimulus('When blocked by capture', () => { called = true; })).rejects.toThrow(/initial state capture failed/);
  nativeExpect(called).toBe(false);
  nativeExpect(initialFailure.run.journal.events().map(({ kind }) => kind)).toEqual(['begin', 'action']);
  nativeExpect(() => { initialFailure.close(); }).toThrow(/state capture failed/);

  const interrupted = lifecycle(request, info.outputDir);
  interrupted.registry.state.observe('available', { value: () => 1 });
  const original = new Error('action failed');
  await nativeExpect(interrupted.run.stimulus('When action fails', () => { throw original; })).rejects.toBe(original);
  const facts = interrupted.run.journal.events();
  nativeExpect(facts.map(({ kind }) => kind)).toEqual(['begin', 'action']);
  nativeExpect(facts[1]).toMatchObject({ kind: 'action', status: 'failed', error: original });
  interrupted.close();
});

test('foreign handles and invalid runtime titles are rejected', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  const foreign = lifecycle(request, info.outputDir);
  const handle = foreign.registry.state.observe('other', { value: () => 1 });
  const outcome = await fixture.run.stimulus('When ready', () => 1);
  nativeExpect(() => outcome.evidence.state(handle)).toThrow();
  await nativeExpect(fixture.run.stimulus('incorrect' as `When ${string}`, () => 1)).rejects.toThrow(/title/);
  await nativeExpect(outcome.verify('incorrect' as `Then ${string}`, () => { expect(1).toBe(1); })).rejects.toThrow(/title/);
  fixture.close(); foreign.close();
});

test('reviewed normalized final state uses native snapshots', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  let rows: { id: string; status: string }[] = [];
  const observer = fixture.registry.state.observe('payments', { rows: () => rows });
  const { evidence, verify } = await fixture.run.stimulus('When accepting payment', () => {
    rows = [{ id: 'generated-id', status: 'succeeded' }];
  });
  await verify('Then final state matches reviewed baseline', () => {
    const normalized = evidence.state(observer).final.rows.map((row) => ({ ...row, id: '<created-intent>' }));
    expect(JSON.stringify(normalized, null, 2) + '\n').toMatchSnapshot('stimulus-state.txt');
  });
  fixture.close();
});

test('unavailable effect coverage records an inconclusive claim', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  const graph = completeGraph([]);
  const open = { ...graph, scope: { ...graph.scope, closed: false }, quality: { ...graph.quality, coverage: 'partial' as const, reasons: ['open'] } };
  const selected = (await recordedEffects(open).capture()).http();
  const outcome = await fixture.run.stimulus('When action runs', () => 1);
  await nativeExpect(outcome.verify('Then no effects occurred', async () => {
    await expect(selected).not.toHaveEmitted();
  })).rejects.toThrow();
  await nativeExpect(outcome.verify('And swallowed unavailable evidence remains inconclusive', async () => {
    try { await expect(selected).not.toHaveEmitted(); } catch { /* deliberate swallow */ }
  })).rejects.toThrow();
  nativeExpect(fixture.run.journal.events().filter((event) => event.kind === 'claim')).toMatchObject([{ status: 'inconclusive' }, { status: 'inconclusive' }]);
  fixture.close();
});

test('interrupted actions retain initial evidence without a final checkpoint', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  const entered = deferred<undefined>();
  const release = deferred<undefined>();
  fixture.registry.state.observe('state', { value: () => 0 });
  const operation = fixture.run.stimulus('When interrupted', async () => {
    entered.resolve(undefined);
    await release.promise;
    return 1;
  });
  await entered.promise;
  fixture.close();
  release.resolve(undefined);
  await nativeExpect(operation).rejects.toThrow(/no longer active/);
  nativeExpect(fixture.run.journal.events().map(({ kind }) => kind)).toEqual(['begin', 'action']);
  nativeExpect(fixture.run.journal.events()[1]).toMatchObject({ kind: 'action', status: 'interrupted' });
});

test('a caught final capture failure remains visible at fixture teardown', async ({ request }, info) => {
  const fixture = lifecycle(request, info.outputDir);
  let changed = false;
  fixture.registry.state.observe('state', { value: () => {
    if (changed) { throw new Error('final reader failure'); }
    return 0;
  } });
  await nativeExpect(fixture.run.stimulus('When state changes', () => { changed = true; })).rejects.toThrow(/final state capture failed/);
  nativeExpect(fixture.run.journal.events().map(({ kind }) => kind)).toEqual(['begin', 'action', 'final']);
  nativeExpect(() => { fixture.close(); }).toThrow(/capture failed/);
});
