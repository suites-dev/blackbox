import { expect, test } from 'vitest';
import { projectObservations } from './project.js';
import { attribute, payload, span, traceId } from './test-fixtures/otlp.js';

test.each([
  ['http', { 'http.method': 'POST', 'http.route': '/orders' }, 'POST', '/orders'],
  ['db', { 'db.operation': 'INSERT', 'db.name': 'orders' }, 'INSERT', 'unknown'],
  ['db', { 'db.operation': 'INSERT', 'db.sql.table': 'orders' }, 'INSERT', 'orders'],
  ['db', { 'db.operation.name': 'SELECT', 'db.collection.name': 'items' }, 'SELECT', 'items'],
  [
    'cache',
    { 'db.operation.name': 'GET', 'db.system.name': 'redis', 'db.namespace': '0' },
    'GET',
    'unknown',
  ],
  [
    'cache',
    { 'db.operation.name': 'GET', 'db.system.name': 'redis', 'db.collection.name': 'orders' },
    'GET',
    'unknown',
  ],
  ['rpc', { 'rpc.method': 'GetOrder', 'rpc.service': 'Orders' }, 'GetOrder', 'Orders'],
  [
    'message',
    { 'messaging.operation': 'send', 'messaging.destination': 'orders' },
    'send',
    'orders',
  ],
] as const)('projects structured %s conventions', (kind, values, operation, target) => {
  const attributes = Object.entries(values).map(([key, value]) => attribute(key, value));
  const graph = projectObservations([payload([span(1, { attributes })])], 'scope');
  expect(graph.effects[0]).toMatchObject({
    kind,
    operation,
    target,
    actor: 'orders',
    outcome: 'unknown',
  });
  expect(graph.scope).toEqual({ id: 'scope', closed: false });
  expect(graph.quality).toMatchObject({
    coverage: 'unknown',
    orderCoverage: 'unknown',
    attestation: 'none',
  });
});

test('does not infer operations, state, domain data, or order from lab annotations', () => {
  const first = span(1, {
    kind: 1,
    name: 'INSERT orders',
    startTimeUnixNano: '1',
    endTimeUnixNano: '2',
    attributes: [attribute('db.statement', 'INSERT INTO orders VALUES (1)')],
  });
  const second = span(2, {
    parentSpanId: first.spanId,
    startTimeUnixNano: '3',
    endTimeUnixNano: '4',
    attributes: [
      attribute('lab.business.operation', 'persist'),
      attribute('lab.business.target', 'orders'),
      attribute('lab.outcome', 'success'),
      attribute('lab.data.order.id', '1'),
    ],
    links: [
      { traceId, spanId: first.spanId, attributes: [attribute('lab.edge.kind', 'happensBefore')] },
    ],
  });
  const graph = projectObservations([payload([first, second])], 'scope');
  expect(
    graph.effects.map(({ kind, operation, outcome, attributes }) => ({
      kind,
      operation,
      outcome,
      attributes,
    })),
  ).toEqual([
    { kind: 'unknown', operation: 'unknown', outcome: 'unknown', attributes: {} },
    { kind: 'unknown', operation: 'unknown', outcome: 'unknown', attributes: {} },
  ]);
  expect(graph.relations.map((relation) => relation.type)).toEqual(['parent', 'link']);
  expect(graph.quality.orderCoverage).toBe('partial');
});

test('deduplicates identical arrivals across fragments but rejects changed raw records', () => {
  const original = span(1, { attributes: [attribute('db.operation', 'INSERT')] });
  expect(
    projectObservations([payload([original]), payload([original])], 'scope').effects,
  ).toHaveLength(1);
  expect(() =>
    projectObservations(
      [payload([original]), payload([{ ...original, endTimeUnixNano: '9' }])],
      'scope',
    ),
  ).toThrow('Conflicting duplicate');
  expect(() =>
    projectObservations([payload([original]), payload([original], 'other-service')], 'scope'),
  ).toThrow('Conflicting duplicate');
});

test('accepts agreeing aliases and rejects conflicting or duplicate semantic facts', () => {
  const legacy = attribute('db.operation', 'INSERT');
  const current = attribute('db.operation.name', 'INSERT');
  expect(
    projectObservations([payload([span(1, { attributes: [legacy, current] })])], 'scope').effects[0]
      .operation,
  ).toBe('INSERT');
  expect(() =>
    projectObservations(
      [payload([span(1, { attributes: [legacy, attribute('db.operation.name', 'SELECT')] })])],
      'scope',
    ),
  ).toThrow('Conflicting semantic aliases');
  expect(() =>
    projectObservations([payload([span(1, { attributes: [legacy, legacy] })])], 'scope'),
  ).toThrow('Duplicate semantic attribute');
});

test.each([
  { intValue: 42 },
  { stringValue: 'INSERT', intValue: 42 },
  { arrayValue: { values: [{ stringValue: 'INSERT' }] } },
])('rejects malformed operation evidence %j', (value) => {
  expect(() =>
    projectObservations(
      [payload([span(1, { attributes: [{ key: 'db.operation.name', value }] })])],
      'scope',
    ),
  ).toThrow('Semantic attribute');
});

test('retains positive witnesses, failure status, and known loss separately', () => {
  const graph = projectObservations(
    [
      payload([
        span(1, {
          parentSpanId: '0000000000000002',
          status: { code: 2 },
          droppedAttributesCount: 1,
          attributes: [attribute('db.operation.name', 'INSERT')],
          links: [{ traceId, spanId: '0000000000000003' }],
        }),
      ]),
    ],
    'scope',
    ['reader diagnostic'],
  );
  expect(graph.effects[0]).toMatchObject({
    kind: 'db',
    operation: 'INSERT',
    target: 'unknown',
    outcome: 'failure',
  });
  expect(graph.quality).toMatchObject({ coverage: 'partial', orderCoverage: 'partial' });
  expect(graph.quality.reasons).toEqual(
    expect.arrayContaining([
      'reader diagnostic',
      'unresolved-parent',
      'unresolved-link',
      'otel-reports-dropped-data',
    ]),
  );
});

test.each([
  undefined,
  { resourceSpans: {} },
  payload([span(0)]),
  payload([span(1, { traceId: 'bad' })]),
])('rejects invalid raw payload %j', (input) => {
  expect(() => projectObservations([input], 'scope')).toThrow(TypeError);
});
