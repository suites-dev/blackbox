import { expect, test } from 'vitest';
import { createEffectCapture } from './create.js';
import { assessEffectRecorder } from './count.js';
import { capture, effect, graph, identity } from './test-fixtures/capture.js';

test('recorders preserve occurrence multiplicity and canonical selector aliases', () => {
  const captured = capture([
    effect('one', 'INSERT'),
    effect('two', 'INSERT'),
    effect('three', 'DELETE'),
  ]);
  const writes = captured.db({ table: 'orders', operation: 'INSERT' });
  expect(writes.emissions.map((emission) => emission.id)).toEqual(['one', 'two']);
  expect(writes.selector).toEqual({
    node: 'selector',
    kind: 'db',
    target: 'orders',
    operation: 'INSERT',
  });
  expect(assessEffectRecorder(writes, { operator: 'exactly', count: 2 }).status).toBe('pass');
  expect(assessEffectRecorder(writes, { operator: 'exactly', count: 1 }).status).toBe('fail');
});

test('capture owns detached immutable graph and identity data', () => {
  const emissions = [effect('one', 'INSERT')];
  const activityIds = ['stimulus-1'];
  const captured = createEffectCapture({
    identity: { ...identity, activityIds },
    graph: graph(emissions),
  });
  emissions.push(effect('late', 'INSERT'));
  Object.assign(emissions[0], { operation: 'DELETE' });
  activityIds.push('later-stimulus');
  const writes = captured.db();
  expect(writes.emissions.map((emission) => emission.id)).toEqual(['one']);
  expect(writes.emissions[0].operation).toBe('INSERT');
  expect(captured.identity.activityIds).toEqual(['stimulus-1']);
  expect(Object.isFrozen(writes.emissions[0].attributes)).toBe(true);
  expect(Object.isFrozen(writes.emissions)).toBe(true);
  expect(Object.isFrozen(writes.identity.activityIds)).toBe(true);
  expect(Object.isFrozen(writes)).toBe(true);
  expect(Object.isFrozen(captured)).toBe(true);
});

test('known contradictions exclude uncertain emissions without inventing missing facts', () => {
  const captured = capture([
    effect('known', 'INSERT'),
    effect('possible', 'unknown', { kind: 'unknown' }),
    effect('excluded', 'unknown', { target: 'other' }),
  ]);
  const writes = captured.db({ table: 'orders', operation: 'INSERT' });
  expect(writes.emissions.map((emission) => emission.id)).toEqual(['known']);
  expect(writes.possibleEmissions.map((emission) => emission.id)).toEqual(['possible']);
});

test('selectors expose all supported kinds without claiming producer support', () => {
  const captured = capture([]);
  expect(captured.http({ method: 'POST', route: '/orders' }).selector).toMatchObject({
    kind: 'http',
    operation: 'POST',
    target: '/orders',
  });
  expect(captured.rpc({ service: 'Orders' }).selector.target).toBe('Orders');
  expect(captured.cache({ keyspace: 'orders' }).selector.target).toBe('orders');
  expect(captured.message({ destination: 'orders' }).selector.target).toBe('orders');
  expect(captured.business().selector.kind).toBe('business');
  expect(captured.internal().selector.kind).toBe('internal');
  expect(captured.span().selector).toEqual({ node: 'selector' });
});

test('mismatched scope, duplicate activity identity and copied recorder are rejected', () => {
  expect(() =>
    createEffectCapture({
      identity: { ...identity, scopeId: 'other' },
      graph: graph([]),
    }),
  ).toThrow('scope identity');
  expect(() =>
    createEffectCapture({
      identity: { ...identity, activityIds: ['duplicate', 'duplicate'] },
      graph: graph([]),
    }),
  ).toThrow('unique');
  expect(() =>
    createEffectCapture({
      identity: { ...identity, activityIds: [''] },
      graph: graph([]),
    }),
  ).toThrow('non-empty');
  const recorder = capture([]).db();
  expect(() => assessEffectRecorder({ ...recorder }, { operator: 'exactly', count: 0 })).toThrow(
    'owned by an immutable capture',
  );
});
