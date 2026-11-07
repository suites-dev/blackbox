import { expect, test } from 'vitest';
import { edge } from '../verification/test-fixtures/graphs.js';
import { createEffectCapture } from './create.js';
import { assessEffectRecorderBefore, assessNthEffectEmission } from './order.js';
import { capture, effect, identity } from './test-fixtures/capture.js';

test('before means every selected first emission precedes every selected second emission', () => {
  const captured = capture(
    [effect('a1', 'INSERT'), effect('a2', 'INSERT'), effect('b', 'COMMIT')],
    { relations: [edge('a1', 'b'), edge('a2', 'b')] },
  );
  expect(
    assessEffectRecorderBefore(
      captured.db({ operation: 'INSERT' }),
      captured.db({ operation: 'COMMIT' }),
    ),
  ).toMatchObject({
    status: 'pass',
    evidence: ['a1', 'a2', 'b'],
    relations: [edge('a1', 'b'), edge('a2', 'b')],
  });
});

test('one later matching first emission disproves all-before, even in an open capture', () => {
  const captured = capture(
    [effect('a1', 'INSERT'), effect('a2', 'INSERT'), effect('b', 'COMMIT')],
    {
      scope: { id: 'fixture', closed: false },
      relations: [edge('a1', 'b'), edge('b', 'a2')],
    },
  );
  expect(
    assessEffectRecorderBefore(
      captured.db({ operation: 'INSERT' }),
      captured.db({ operation: 'COMMIT' }),
    ),
  ).toMatchObject({ status: 'fail', evidence: ['a2', 'b'] });
});

test('ordering cannot mix distinct captures with identical identity labels', () => {
  const effects = [effect('a', 'INSERT'), effect('b', 'COMMIT')];
  const left = capture(effects, { relations: [edge('a', 'b')] });
  const right = capture(effects, { relations: [edge('a', 'b')] });
  expect(left.identity).toEqual(right.identity);
  expect(() => assessEffectRecorderBefore(left.db(), right.db())).toThrow('same immutable capture');
});

test('parent relations and unknown ordering coverage cannot establish before', () => {
  const captured = capture([effect('a', 'INSERT'), effect('b', 'COMMIT')], {
    quality: {
      coverage: 'complete',
      orderCoverage: 'unknown',
      reasons: [],
      attestation: 'fixture',
    },
    relations: [{ type: 'parent', from: 'a', to: 'b', evidence: 'parentage' }],
  });
  expect(
    assessEffectRecorderBefore(
      captured.db({ operation: 'INSERT' }),
      captured.db({ operation: 'COMMIT' }),
    ).status,
  ).toBe('inconclusive');
});

test('nth emission follows proven causality rather than shuffled ingestion order', () => {
  const captured = capture(
    [effect('third', 'COMMIT'), effect('first', 'INSERT'), effect('second', 'UPDATE')],
    { relations: [edge('first', 'second'), edge('second', 'third')] },
  );
  const recorder = captured.db();
  expect(assessNthEffectEmission(recorder, 1, (emission) => emission.id === 'first').status).toBe(
    'pass',
  );
  expect(assessNthEffectEmission(recorder, 2, (emission) => emission.id === 'second').status).toBe(
    'pass',
  );
  expect(assessNthEffectEmission(recorder, 2, (emission) => emission.id === 'first').status).toBe(
    'fail',
  );
  expect(assessNthEffectEmission(recorder, 3, () => null)).toMatchObject({
    status: 'inconclusive',
    possibleEvidence: ['third'],
  });
});

test('concurrent predecessors can prove a unique later ordinal without sorting their tie', () => {
  const captured = capture([effect('a', 'INSERT'), effect('b', 'INSERT'), effect('c', 'COMMIT')], {
    relations: [edge('a', 'c'), edge('b', 'c')],
  });
  expect(assessNthEffectEmission(captured.db(), 1, () => true).status).toBe('inconclusive');
  expect(assessNthEffectEmission(captured.db(), 2, () => true).status).toBe('inconclusive');
  expect(assessNthEffectEmission(captured.db(), 3, (emission) => emission.id === 'c').status).toBe(
    'pass',
  );
});

test('nth cannot ignore missing predecessors or unresolved selections', () => {
  const open = capture([effect('one', 'INSERT')], {
    scope: { id: 'fixture', closed: false },
  }).db();
  const uncertain = capture([
    effect('one', 'INSERT'),
    effect('maybe', 'unknown', { kind: 'unknown' }),
  ]).db();
  for (const recorder of [open, uncertain]) {
    expect(assessNthEffectEmission(recorder, 1, () => true).status).toBe('inconclusive');
  }
  expect(
    assessNthEffectEmission(capture([effect('one', 'INSERT')]).db(), 2, () => true).status,
  ).toBe('fail');
});

test('unavailable ordering stays inconclusive and invalid ordinal is rejected', () => {
  const unavailable = createEffectCapture({ identity, unavailable: { reason: 'missing' } });
  expect(assessEffectRecorderBefore(unavailable.db(), unavailable.http()).status).toBe(
    'inconclusive',
  );
  expect(assessNthEffectEmission(unavailable.db(), 1, () => true).status).toBe('inconclusive');
  expect(() => assessNthEffectEmission(capture([]).db(), 0, () => true)).toThrow('positive');
});
