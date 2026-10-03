import { expect, test } from 'vitest';
import { compileEffectContract } from '../contract.js';
import { attribute, payload, span } from '../testing/observations.fixture.js';
import { createEffectContractEvaluator } from './evaluator.js';
import type { EffectObservationReadResult } from './source.js';

const insertion = span(1, {
  attributes: [attribute('db.operation.name', 'INSERT'), attribute('db.collection.name', 'orders')],
});
const exists = compileEffectContract((fx) => [
  fx.exists(fx.db({ operation: 'INSERT', target: 'orders' })),
]);
const absent = compileEffectContract((fx) => [
  fx.absent(fx.db({ operation: 'INSERT', target: 'orders' })),
]);

function evaluator(payloads: readonly unknown[]) {
  return createEffectContractEvaluator({
    read: () =>
      Promise.resolve({ kind: 'admitted', scopeId: 'fixed-scope', payloads, diagnostics: [] }),
  });
}

test('a structured operation proves existence and disproves absence through the public AST', async () => {
  const candidate = evaluator([payload([insertion])]);
  await expect(candidate.evaluate(exists)).resolves.toEqual({ kind: 'satisfied' });
  await expect(candidate.evaluate(absent)).resolves.toMatchObject({
    kind: 'unsatisfied',
    message: expect.stringContaining('observed lower=1, upper=unbounded'),
  });
});

test('empty, unknown, and partial observations cannot prove absence or exactness', async () => {
  for (const payloads of [
    [],
    [payload([])],
    [payload([span(1)])],
    [payload([span(1, { droppedEventsCount: 1 })])],
  ]) {
    await expect(evaluator(payloads).evaluate(absent)).resolves.toMatchObject({
      kind: 'inconclusive',
    });
    await expect(evaluator(payloads).evaluate(exists)).resolves.toMatchObject({
      kind: 'inconclusive',
    });
  }
  const exactly = compileEffectContract((fx) => [fx.exactly(1, fx.db({ operation: 'INSERT' }))]);
  await expect(evaluator([payload([insertion])]).evaluate(exactly)).resolves.toMatchObject({
    kind: 'inconclusive',
  });
});

test('known loss does not erase an observed positive witness', async () => {
  await expect(
    evaluator([payload([{ ...insertion, droppedAttributesCount: 1 }])]).evaluate(exists),
  ).resolves.toEqual({ kind: 'satisfied' });
});

test('database namespaces cannot satisfy public table or cache target selectors', async () => {
  const database = payload([
    span(1, {
      attributes: [attribute('db.operation.name', 'INSERT'), attribute('db.namespace', 'ordersdb')],
    }),
  ]);
  const table = compileEffectContract((fx) => [fx.exists(fx.db({ table: 'ordersdb' }))]);
  await expect(evaluator([database]).evaluate(table)).resolves.toMatchObject({
    kind: 'inconclusive',
  });
  for (const targetField of ['db.namespace', 'db.collection.name']) {
    const cache = payload([
      span(1, {
        attributes: [
          attribute('db.operation.name', 'GET'),
          attribute('db.system.name', 'redis'),
          attribute(targetField, '0'),
        ],
      }),
    ]);
    const key = compileEffectContract((fx) => [fx.exists(fx.cache({ target: '0' }))]);
    await expect(evaluator([cache]).evaluate(key)).resolves.toMatchObject({ kind: 'inconclusive' });
    const operation = compileEffectContract((fx) => [fx.exists(fx.cache({ operation: 'GET' }))]);
    await expect(evaluator([cache]).evaluate(operation)).resolves.toEqual({ kind: 'satisfied' });
  }
});

test.each(['unavailable', 'rejected'] as const)('%s source is inconclusive', async (kind) => {
  const candidate = createEffectContractEvaluator({
    read: () => Promise.resolve({ kind, message: 'No admitted activity' }),
  });
  await expect(candidate.evaluate(exists)).resolves.toEqual({
    kind: 'inconclusive',
    message: 'No admitted activity',
  });
});

test('conflicting records and aliases quarantine the whole assertion despite a good witness', async () => {
  const changed = { ...insertion, name: 'different record' };
  const conflict = span(2, {
    attributes: [attribute('db.operation', 'SELECT'), attribute('db.operation.name', 'INSERT')],
  });
  for (const payloads of [
    [payload([insertion]), payload([changed])],
    [payload([insertion, conflict])],
    [{}],
  ]) {
    await expect(evaluator(payloads).evaluate(exists)).resolves.toMatchObject({
      kind: 'inconclusive',
      message: expect.stringContaining('observation rejected'),
    });
    await expect(evaluator(payloads).evaluate(absent)).resolves.toMatchObject({
      kind: 'inconclusive',
    });
  }
});

test('deduplicated deliveries cannot manufacture a second effect', async () => {
  const twice = compileEffectContract((fx) => [fx.atLeast(2, fx.db({ operation: 'INSERT' }))]);
  await expect(
    evaluator([payload([insertion]), payload([insertion])]).evaluate(twice),
  ).resolves.toMatchObject({ kind: 'inconclusive', message: expect.stringContaining('lower=1') });
});

test('re-reads the same injected source per evaluation without retaining stale observations', async () => {
  let reads = 0;
  const candidate = createEffectContractEvaluator({
    read: () => {
      reads += 1;
      return Promise.resolve({
        kind: 'admitted',
        scopeId: 'fixed-scope',
        payloads: reads === 1 ? [] : [payload([insertion])],
        diagnostics: [],
      });
    },
  });
  await expect(candidate.evaluate(exists)).resolves.toMatchObject({ kind: 'inconclusive' });
  await expect(candidate.evaluate(exists)).resolves.toEqual({ kind: 'satisfied' });
  expect(reads).toBe(2);
});

test('does not accept source completeness fields as a closure attestation', async () => {
  const read = {
    kind: 'admitted',
    scopeId: 'fixed-scope',
    payloads: [],
    diagnostics: [],
    closed: true,
    coverage: 'complete',
    attestation: 'invented',
  } satisfies EffectObservationReadResult & {
    closed: boolean;
    coverage: string;
    attestation: string;
  };
  const candidate = createEffectContractEvaluator({ read: () => Promise.resolve(read) });
  await expect(candidate.evaluate(absent)).resolves.toMatchObject({ kind: 'inconclusive' });
});

test('does not treat status OK or an INSERT attempt as persisted success', async () => {
  const success = compileEffectContract((fx) => [
    fx.exists(fx.db({ operation: 'INSERT', outcome: 'success' })),
  ]);
  await expect(
    evaluator([payload([{ ...insertion, status: { code: 1 } }])]).evaluate(success),
  ).resolves.toMatchObject({ kind: 'inconclusive' });
  const failure = compileEffectContract((fx) => [
    fx.exists(fx.db({ operation: 'INSERT', outcome: 'failure' })),
  ]);
  await expect(
    evaluator([payload([{ ...insertion, status: { code: 2 } }])]).evaluate(failure),
  ).resolves.toEqual({ kind: 'satisfied' });
});

test('a concrete contradiction wins over a separate unknown constraint', async () => {
  const mixed = compileEffectContract((fx) => [
    fx.exists(fx.message()),
    fx.absent(fx.db({ operation: 'INSERT' })),
  ]);
  await expect(evaluator([payload([insertion])]).evaluate(mixed)).resolves.toMatchObject({
    kind: 'unsatisfied',
  });
});
