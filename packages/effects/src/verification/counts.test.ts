import { expect, test } from 'vitest';
import { compileEffectContract, type EffectCountOperator } from '../contract.js';
import { adaptContract } from '../evaluation/contract-adapter.js';
import { matches } from './selectors.js';
import { effect, graph } from './test-fixtures/graphs.js';
import { verify } from './verify.js';

const known = effect('known', 'INSERT');
const unknown = effect('unknown', 'unknown', { kind: 'unknown' });

test.each([
  ['atLeast', 1, false, 'pass'],
  ['exactly', 1, false, 'inconclusive'],
  ['atMost', 0, false, 'fail'],
  ['exactly', 0, false, 'fail'],
  ['atLeast', 2, false, 'inconclusive'],
  ['atLeast', 1, true, 'pass'],
  ['exactly', 1, true, 'pass'],
  ['atMost', 1, true, 'pass'],
  ['atLeast', 2, true, 'fail'],
  ['exactly', 2, true, 'fail'],
] satisfies readonly (readonly [EffectCountOperator, number, boolean, string])[])(
  '%s %s with closed=%s yields %s',
  (operator, count, closed, status) => {
    const contract = compileEffectContract((fx) => [
      fx[operator](count, fx.db({ operation: 'INSERT' })),
    ]);
    const assessment = verify(
      graph([known], { scope: { id: 'scope', closed } }),
      adaptContract(contract),
    );
    expect(assessment.status).toBe(status);
    expect(assessment.findings[0].evidence).toEqual(['known']);
  },
);

test('unknown possible matches prevent exactness but preserve witnessed positives and violations', () => {
  const contract = compileEffectContract((fx) => [
    fx.exists(fx.db({ operation: 'INSERT' })),
    fx.exactly(1, fx.db({ operation: 'INSERT' })),
    fx.atMost(0, fx.db({ operation: 'INSERT' })),
  ]);
  const assessment = verify(graph([known, unknown]), adaptContract(contract));
  expect(assessment.findings.map((finding) => finding.status)).toEqual([
    'pass',
    'inconclusive',
    'fail',
  ]);
  expect(assessment.status).toBe('fail');
});

test('missing attributes remain possible and known contradictions exclude them', () => {
  expect(matches(unknown, { node: 'selector', kind: 'db', operation: 'INSERT' })).toBeNull();
  expect(matches(unknown, { node: 'selector', kind: 'db', actor: 'other' })).toBe(false);
  expect(matches(known, { node: 'selector', where: { 'order.id': '1' } })).toBeNull();
  expect(
    matches(effect('data', 'unknown', { attributes: { 'order.id': '2' } }), {
      node: 'selector',
      operation: 'INSERT',
      where: { 'order.id': '1' },
    }),
  ).toBe(false);
});

test('absence is unknown in open or partial capture and a witness disproves it', () => {
  const contract = adaptContract(
    compileEffectContract((fx) => [fx.absent(fx.db({ operation: 'INSERT' }))]),
  );
  expect(verify(graph([], { scope: { id: 'open', closed: false } }), contract).status).toBe(
    'inconclusive',
  );
  expect(
    verify(
      graph([], {
        quality: {
          coverage: 'partial',
          orderCoverage: 'unknown',
          attestation: 'fixture',
          reasons: [],
        },
      }),
      contract,
    ).status,
  ).toBe('inconclusive');
  expect(verify(graph([]), contract).status).toBe('pass');
  expect(verify(graph([known]), contract).status).toBe('fail');
});
