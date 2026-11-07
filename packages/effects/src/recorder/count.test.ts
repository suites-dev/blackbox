import { expect, test } from 'vitest';
import type { EffectCountOperator } from '../contract.js';
import { createEffectCapture } from './create.js';
import { assessEffectRecorder } from './count.js';
import { capture, effect, identity } from './test-fixtures/capture.js';

test.each([
  ['atLeast', 1, false, 'pass'],
  ['exactly', 1, false, 'inconclusive'],
  ['atMost', 0, false, 'fail'],
  ['atLeast', 2, false, 'inconclusive'],
  ['atLeast', 2, true, 'fail'],
  ['exactly', 1, true, 'pass'],
  ['atMost', 1, true, 'pass'],
] satisfies readonly (readonly [EffectCountOperator, number, boolean, string])[])(
  '%s %s with closed=%s yields %s for a recorder',
  (operator, count, closed, status) => {
    const writes = capture([effect('one', 'INSERT')], { scope: { id: 'fixture', closed } }).db();
    expect(assessEffectRecorder(writes, { operator, count })).toMatchObject({
      status,
      evidence: ['one'],
      lowerBound: 1,
      upperBound: closed ? 1 : null,
    });
  },
);

test('absence stays inconclusive in open or partial observation', () => {
  const empty = capture([], { scope: { id: 'fixture', closed: false } }).db();
  const partial = capture([], {
    quality: {
      coverage: 'partial',
      orderCoverage: 'unknown',
      reasons: ['lost spans'],
      attestation: 'none',
    },
  }).db();
  for (const recorder of [empty, partial]) {
    expect(assessEffectRecorder(recorder, { operator: 'exactly', count: 0 }).status).toBe(
      'inconclusive',
    );
  }
  expect(assessEffectRecorder(capture([]).db(), { operator: 'exactly', count: 0 }).status).toBe(
    'pass',
  );
});

test('payload predicates cannot promote possible selector matches', () => {
  const writes = capture([
    effect('known', 'INSERT'),
    effect('unknown', 'unknown', { kind: 'unknown' }),
  ]).db({ operation: 'INSERT' });
  expect(assessEffectRecorder(writes, { operator: 'exactly', count: 2 }, () => true)).toMatchObject(
    {
      status: 'inconclusive',
      lowerBound: 1,
      upperBound: 2,
      evidence: ['known'],
      possibleEvidence: ['unknown'],
    },
  );
});

test('unknown payload facts downgrade witnesses while known mismatches exclude occurrences', () => {
  const writes = capture([effect('one', 'INSERT'), effect('two', 'INSERT')]).db();
  expect(
    assessEffectRecorder(writes, { operator: 'atLeast', count: 1 }, (emission) =>
      emission.id === 'one' ? false : null,
    ),
  ).toMatchObject({
    status: 'inconclusive',
    lowerBound: 0,
    upperBound: 1,
    evidence: [],
    possibleEvidence: ['two'],
  });
  expect(assessEffectRecorder(writes, { operator: 'atLeast', count: 1 }, () => false).status).toBe(
    'fail',
  );
});

test('unavailable is not a fabricated empty complete graph, including tautological counts', () => {
  const writes = createEffectCapture({
    identity,
    unavailable: { reason: 'collector missing' },
  }).db();
  expect(writes.available).toBe(false);
  const predicate = () => {
    throw new Error('must not examine nonexistent observations');
  };
  expect(assessEffectRecorder(writes, { operator: 'atLeast', count: 0 }, predicate)).toMatchObject({
    status: 'inconclusive',
    reason: 'collector missing',
    upperBound: null,
  });
  expect(assessEffectRecorder(writes, { operator: 'exactly', count: 0 }).status).toBe(
    'inconclusive',
  );
});

test('malformed count and asynchronous predicate results fail at the API boundary', () => {
  const writes = capture([effect('one', 'INSERT')]).db();
  expect(() => assessEffectRecorder(writes, { operator: 'exactly', count: -1 })).toThrow(
    'nonnegative safe integer',
  );
  expect(() => assessEffectRecorder(writes, { operator: 'exactly', count: 0.5 })).toThrow(
    'nonnegative safe integer',
  );
  expect(() =>
    // @ts-expect-error Async predicates cannot decide a synchronous captured emission.
    assessEffectRecorder(writes, { operator: 'atLeast', count: 1 }, () => Promise.resolve(true)),
  ).toThrow('true, false, or null');
});
