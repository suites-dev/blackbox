import { expect, test } from 'vitest';
import { compileEffectContract } from '../contract.js';
import { adaptContract } from '../evaluation/contract-adapter.js';
import { edge, effect, graph } from './test-fixtures/graphs.js';
import { verify } from './verify.js';

const contract = adaptContract(
  compileEffectContract((fx) => [fx.before(fx.db({ operation: 'A' }), fx.db({ operation: 'B' }))]),
);
const a = effect('a', 'A');
const b = effect('b', 'B');

test('uses only explicit causal edges, including their transitive closure', () => {
  const intermediary = effect('middle', 'C');
  expect(
    verify(
      graph([a, intermediary, b], { relations: [edge('a', 'middle'), edge('middle', 'b')] }),
      contract,
    ).status,
  ).toBe('pass');
  for (const type of ['parent', 'link'] as const) {
    const assessment = verify(
      graph([a, b], {
        relations: [{ ...edge('a', 'b'), type }],
        quality: {
          coverage: 'complete',
          orderCoverage: 'unknown',
          attestation: 'fixture',
          reasons: [],
        },
      }),
      contract,
    );
    expect(assessment.status).toBe('inconclusive');
  }
});

test('missing order distinguishes open, partial order, and complete order fixtures', () => {
  expect(verify(graph([a, b], { scope: { id: 'open', closed: false } }), contract).status).toBe(
    'inconclusive',
  );
  expect(
    verify(
      graph([a, b], {
        quality: {
          coverage: 'complete',
          orderCoverage: 'partial',
          attestation: 'fixture',
          reasons: [],
        },
      }),
      contract,
    ).status,
  ).toBe('inconclusive');
  expect(verify(graph([a, b]), contract).status).toBe('fail');
  expect(
    verify(
      graph([a, b], { relations: [edge('a', 'b')], scope: { id: 'open', closed: false } }),
      contract,
    ).status,
  ).toBe('inconclusive');
});

test.each([
  ['a1', 'a2', 'b1', 'b2'],
  ['b2', 'a1', 'b1', 'a2'],
  ['b1', 'a2', 'b2', 'a1'],
  ['a2', 'b2', 'a1', 'b1'],
])('a later reverse witness dominates earlier missing pairs: %j', (...ids) => {
  const effects = ids.map((id) => effect(id, id.startsWith('a') ? 'A' : 'B'));
  const assessment = verify(
    graph(effects, { relations: [edge('b2', 'a2')], scope: { id: 'open', closed: false } }),
    contract,
  );
  expect(assessment.status).toBe('fail');
  expect(assessment.findings[0].reason).toBe('Self-ordering or reverse causal witness');
  expect(assessment.findings[0].evidence).toEqual(['a2', 'b2']);
});

test('self-ordering is a contradiction even with preceding unknown pairs', () => {
  const selfContract = adaptContract(
    compileEffectContract((fx) => [fx.before(fx.db({ operation: 'A' }), fx.span())]),
  );
  expect(
    verify(graph([effect('other', 'C'), a], { scope: { id: 'open', closed: false } }), selfContract)
      .status,
  ).toBe('fail');
});

test('possible bindings and missing endpoints remain unknown without a contradiction', () => {
  expect(
    verify(graph([a, b, effect('unknown', 'unknown')], { relations: [edge('a', 'b')] }), contract)
      .status,
  ).toBe('inconclusive');
  expect(verify(graph([a], { scope: { id: 'open', closed: false } }), contract).status).toBe(
    'inconclusive',
  );
  expect(verify(graph([a]), contract).status).toBe('fail');
});

test('rejects cyclic, dangling, and duplicate-identity graphs', () => {
  expect(() =>
    verify(graph([a, b], { relations: [edge('a', 'b'), edge('b', 'a')] }), contract),
  ).toThrow('acyclic');
  expect(() => verify(graph([a], { relations: [edge('a', 'missing')] }), contract)).toThrow(
    'Dangling',
  );
  expect(() => verify(graph([a, a]), contract)).toThrow('Duplicate effect identities');
});
