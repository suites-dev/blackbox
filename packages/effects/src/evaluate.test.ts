import { expect, test } from 'vitest';
import {
  compileEffectContract,
  evaluateEffects,
  projectEffects,
  type EffectContract,
  type EffectContractBuilder,
  type EffectGraph,
} from './index.js';
import { attribute, payload, span } from './normalization/test-fixtures/otlp.js';
import { edge, effect, graph } from './verification/test-fixtures/graphs.js';

const exists = compileEffectContract((fx) => [
  fx.exists(fx.db({ operation: 'INSERT', table: 'orders' })),
]);
const absent = compileEffectContract((fx) => [
  fx.absent(fx.db({ operation: 'INSERT', table: 'orders' })),
]);
const insertion = effect('insert', 'INSERT');

function evaluateUnknown(inputGraph: unknown, contract: unknown) {
  return evaluateEffects(inputGraph as EffectGraph, contract as EffectContract);
}

test('plain callers project, compile, and evaluate positive, negative, and unknown evidence', () => {
  const input = payload([
    span(1, {
      attributes: [
        attribute('db.operation.name', 'INSERT'),
        attribute('db.collection.name', 'orders'),
      ],
    }),
  ]);
  const projected = projectEffects({
    format: 'otlp-json',
    scopeId: 'plain-node',
    payloads: [input],
  });
  expect(evaluateEffects(projected, exists)).toMatchObject({
    status: 'pass',
    scope: 'plain-node',
    semanticsVersion: '0.1.0',
  });
  const violation = evaluateEffects(projected, absent);
  expect(violation.status).toBe('fail');
  expect(violation.findings[0].evidence).toEqual([projected.effects[0].id]);
  const empty = projectEffects({ format: 'otlp-json', scopeId: 'empty', payloads: [] });
  expect(evaluateEffects(empty, absent).status).toBe('inconclusive');
  expect(evaluateEffects(empty, exists).status).toBe('inconclusive');
});

test('freezes the whole assessment without freezing caller graphs or ASTs', () => {
  const input = graph([insertion]);
  const contract = {
    schemaVersion: 1,
    constraints: [
      {
        node: 'constraint',
        operator: 'atLeast',
        count: 1,
        selector: { node: 'selector', kind: 'db' },
      },
    ],
  };
  const assessment = evaluateUnknown(input, contract);
  for (const owned of [
    assessment,
    assessment.findings,
    assessment.findings[0],
    assessment.findings[0].evidence,
  ]) {
    expect(Object.isFrozen(owned)).toBe(true);
  }
  for (const caller of [
    input,
    input.effects,
    insertion,
    contract,
    contract.constraints,
    contract.constraints[0],
  ]) {
    expect(Object.isFrozen(caller)).toBe(false);
  }
  contract.constraints[0].count = 9;
  expect(assessment.status).toBe('pass');
});

test('snapshots changing graph and contract accessors exactly once', () => {
  let operationReads = 0;
  let countReads = 0;
  const observed = {
    ...insertion,
    get operation() {
      operationReads += 1;
      return operationReads === 1 ? 'INSERT' : 'DELETE';
    },
  };
  const contract = {
    schemaVersion: 1,
    constraints: [
      {
        node: 'constraint',
        operator: 'atLeast',
        get count() {
          countReads += 1;
          return countReads === 1 ? 1 : -1;
        },
        selector: { node: 'selector', kind: 'db', operation: 'INSERT' },
      },
    ],
  };
  expect(evaluateUnknown(graph([observed]), contract).status).toBe('pass');
  expect({ operationReads, countReads }).toEqual({ operationReads: 1, countReads: 1 });
});

test('explicit caller completeness is evaluated as the caller attestation', () => {
  expect(evaluateEffects(graph([]), absent).status).toBe('pass');
  expect(
    evaluateEffects(
      graph([], {
        quality: {
          coverage: 'partial',
          orderCoverage: 'unknown',
          attestation: 'caller',
          reasons: [],
        },
      }),
      absent,
    ).status,
  ).toBe('inconclusive');
});

test.each([
  null,
  {},
  { ...graph([]), schemaVersion: 'future' },
  { ...graph([]), scope: { id: 'scope', closed: 'yes' } },
  {
    ...graph([]),
    quality: { coverage: 'certain', orderCoverage: 'unknown', attestation: 'caller', reasons: [] },
  },
  { ...graph([]), effects: [null] },
  { ...graph([]), effects: [{ ...insertion, operation: undefined }] },
  { ...graph([]), effects: [{ ...insertion, attributes: { nested: {} } }] },
  { ...graph([]), effects: [{ ...insertion, attributes: { count: NaN } }] },
  { ...graph([]), effects: [{ ...insertion, source: [{}] }] },
  { ...graph([insertion]), relations: [{ ...edge('insert', 'insert'), type: 'timestamp' }] },
  graph([insertion, insertion]),
  graph([insertion], { relations: [edge('insert', 'missing')] }),
  graph([insertion], { relations: [edge('insert', 'insert')] }),
])('rejects malformed graph input %j', (candidate) => {
  expect(() => evaluateUnknown(candidate, exists)).toThrow(TypeError);
});

test.each([NaN, Infinity, -1, 1.5, '1', null, undefined])(
  'rejects untyped count %j before verification',
  (count) => {
    const candidate = {
      schemaVersion: 1,
      constraints: [
        { node: 'constraint', operator: 'exactly', count, selector: { node: 'selector' } },
      ],
    };
    expect(() => evaluateUnknown(graph([]), candidate)).toThrow(TypeError);
  },
);

test.each([
  null,
  {},
  { ...exists, schemaVersion: '0.1.0' },
  { ...exists, schemaVersion: 2 },
  { schemaVersion: 1, constraints: [] },
  { schemaVersion: 1, constraints: new Array<unknown>(1) },
  { schemaVersion: 1, constraints: [{ node: 'constraint', operator: 'eventually' }] },
  {
    schemaVersion: 1,
    constraints: [
      {
        node: 'constraint',
        operator: 'atLeast',
        count: 1,
        selector: { node: 'selector', kind: 'unsupported' },
      },
    ],
  },
  {
    schemaVersion: 1,
    constraints: [
      {
        node: 'constraint',
        operator: 'atLeast',
        count: 1,
        selector: { node: 'selector', where: { invalid: {} } },
      },
    ],
  },
])('rejects malformed canonical contract %j', (candidate) => {
  expect(() => evaluateUnknown(graph([insertion]), candidate)).toThrow(TypeError);
});

test('neutral compilation errors contain no matcher instruction', () => {
  const invalid: unknown = null;
  expect(() => compileEffectContract(invalid as EffectContractBuilder)).toThrow(
    'Expected an effect contract builder callback',
  );
  expect(() => compileEffectContract(invalid as EffectContractBuilder)).not.toThrow('toSatisfy');
});
