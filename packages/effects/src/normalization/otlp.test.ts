import { expect, test } from 'vitest';
import { compileEffectContract, evaluateEffects, projectEffects } from '../index.js';
import { attribute, payload, span } from './test-fixtures/otlp.js';

function project(...payloads: unknown[]) {
  return projectEffects({ format: 'otlp-json', scopeId: 'otlp-conformance', payloads });
}

test.each([{}, { resourceSpans: null }, { resourceSpans: [] }])(
  'accepts an empty OTLP request without claiming absence: %j',
  (request) => {
    const graph = project(request);
    expect(graph.effects).toEqual([]);
    expect(graph.scope.closed).toBe(false);
    expect(
      evaluateEffects(
        graph,
        compileEffectContract((e) => [e.absent(e.db())]),
      ).status,
    ).toBe('inconclusive');
  },
);

test('ignores unknown message fields, including within AnyValue and duplicate exports', () => {
  const originalSpan = span(1, { attributes: [attribute('db.operation.name', 'INSERT')] });
  const original = payload([originalSpan]);
  const future = {
    resourceSpans: [
      {
        ...original.resourceSpans[0],
        futureResourceSpans: true,
        scopeSpans: [
          {
            ...original.resourceSpans[0].scopeSpans[0],
            spans: [
              {
                ...originalSpan,
                futureSpan: { value: 'ignored' },
                attributes: [
                  {
                    key: 'db.operation.name',
                    futureKeyValue: 1,
                    value: { stringValue: 'INSERT', futureAnyValue: true },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const graph = project(original, future);
  expect(graph.effects).toHaveLength(1);
  expect(graph.effects[0]).toMatchObject({ kind: 'db', operation: 'INSERT' });
});

test.each(['STATUS_CODE_ERROR', '2', 2.5, 2147483648])(
  'rejects invalid OTLP status enum %j instead of silently losing error evidence',
  (code) => {
    expect(() => project(payload([span(1, { status: { code } })]))).toThrow('OTLP enum');
  },
);

test.each(['SPAN_KIND_CLIENT', '3', 1.5])('rejects invalid OTLP span kind %j', (kind) => {
  expect(() => project(payload([span(1, { kind })]))).toThrow('OTLP enum');
});

test.each([
  [null, 'unknown'],
  [0, 'unknown'],
  [1, 'unknown'],
  [2, 'failure'],
  [99, 'unknown'],
] as const)('interprets numeric status %j conservatively', (code, outcome) => {
  expect(project(payload([span(1, { status: { code } })])).effects[0].outcome).toBe(outcome);
});

test('accepts null parent identity as unset and case-insensitive trace/span hex', () => {
  const graph = project(
    payload([
      span(1, {
        traceId: 'ABCDEF0123456789ABCDEF0123456789',
        spanId: 'ABCDEF0123456789',
        parentSpanId: null,
      }),
    ]),
  );
  expect(graph.effects[0].source).toEqual([
    {
      traceId: 'abcdef0123456789abcdef0123456789',
      spanId: 'abcdef0123456789',
    },
  ]);
  expect(graph.relations).toEqual([]);
});

test('empty or unset semantic strings supply no operation or destination evidence', () => {
  const graph = project(
    payload([
      span(1, { attributes: [attribute('db.operation.name', '')] }),
      span(2, { attributes: [{ key: 'http.request.method', value: {} }] }),
      span(3, {
        attributes: [
          attribute('messaging.operation', 'send'),
          attribute('messaging.destination', ''),
        ],
      }),
    ]),
  );
  expect(graph.effects.map(({ kind, operation, target }) => ({ kind, operation, target }))).toEqual(
    [
      { kind: 'unknown', operation: 'unknown', target: 'unknown' },
      { kind: 'unknown', operation: 'unknown', target: 'unknown' },
      { kind: 'message', operation: 'send', target: 'unknown' },
    ],
  );
});

test('preserves operation values and explicit RabbitMQ destinations without inventing migrations', () => {
  const graph = project(
    payload([
      span(1, { attributes: [attribute('db.operation.name', 'findAndModify')] }),
      span(2, {
        attributes: [
          attribute('messaging.operation.type', 'send'),
          attribute('messaging.operation.name', 'publish'),
          attribute('messaging.destination.name', 'orders:created'),
        ],
      }),
      span(3, { attributes: [attribute('messaging.operation.name', 'publish')] }),
    ]),
  );
  expect(graph.effects.map(({ kind, operation, target }) => ({ kind, operation, target }))).toEqual(
    [
      { kind: 'db', operation: 'findAndModify', target: 'unknown' },
      { kind: 'message', operation: 'send', target: 'orders:created' },
      { kind: 'unknown', operation: 'unknown', target: 'unknown' },
    ],
  );
});
