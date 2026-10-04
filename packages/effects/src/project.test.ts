import { expect, test } from 'vitest';
import { projectEffects, type EffectProjectionInput } from './index.js';
import { attribute, payload, span } from './normalization/test-fixtures/otlp.js';

function projectUnknown(input: unknown) {
  return projectEffects(input as EffectProjectionInput);
}

test('returns deeply immutable facts without freezing or retaining caller-owned telemetry', () => {
  const operation = attribute('http.request.method', 'POST');
  const request = payload([
    span(1, { attributes: [operation, attribute('http.route', '/orders')] }),
  ]);
  const input = { format: 'otlp-json', scopeId: 'plain-node', payloads: [request] } as const;
  const graph = projectEffects(input);
  expect(graph.effects[0]).toMatchObject({ kind: 'http', operation: 'POST', target: '/orders' });
  for (const own of [
    graph,
    graph.scope,
    graph.quality,
    graph.quality.reasons,
    graph.effects,
    graph.effects[0],
    graph.effects[0].attributes,
    graph.effects[0].source,
    graph.effects[0].source[0],
    graph.relations,
  ]) {
    expect(Object.isFrozen(own)).toBe(true);
  }
  expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(request)).toBe(false);
  expect(Object.isFrozen(operation.value)).toBe(false);
  operation.value.stringValue = 'DELETE';
  expect(graph.effects[0].operation).toBe('POST');
});

test('rejects telemetry accessors without executing their code', () => {
  let reads = 0;
  const raw = payload([
    span(1, {
      attributes: [
        {
          key: 'http.request.method',
          value: {
            get stringValue() {
              reads += 1;
              return reads === 1 ? 'POST' : 'DELETE';
            },
          },
        },
      ],
    }),
  ]);
  expect(() => projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: [raw] })).toThrow(
    'Telemetry accessors are not JSON data',
  );
  expect(reads).toBe(0);
});

test('snapshots inert telemetry without invoking caller array iterators or map methods', () => {
  const payloads = [payload([span(1, { attributes: [attribute('http.request.method', 'POST')] })])];
  payloads[Symbol.iterator] = () => [][Symbol.iterator]();
  payloads.map = () => [];
  const graph = projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads });
  expect(graph.effects).toHaveLength(1);
  expect(graph.effects[0].operation).toBe('POST');
});

test('rejects accessor array elements without running the getter', () => {
  let reads = 0;
  const payloads = [payload([])];
  Object.defineProperty(payloads, '0', {
    get() {
      reads += 1;
      throw new Error('Application getter must not run');
    },
  });
  expect(() => projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads })).toThrow(
    'Telemetry accessors are not JSON data',
  );
  expect(reads).toBe(0);
});

test('rejects telemetry proxies before invoking reflection traps', () => {
  let traps = 0;
  const raw = new Proxy(payload([]), {
    ownKeys() {
      traps += 1;
      throw new Error('Application proxy trap must not run');
    },
  });
  expect(() => projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: [raw] })).toThrow(
    'Telemetry proxies are not JSON data',
  );
  expect(traps).toBe(0);
});

test('rejects revoked proxies and accepts ordinary JSON after a capture rejection', () => {
  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  expect(() => projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: proxy })).toThrow(
    'Telemetry proxies are not JSON data',
  );
  expect(
    projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: [payload([span(1)])] })
      .effects,
  ).toHaveLength(1);
});

test('complete-looking raw telemetry never grants scope closure or coverage', () => {
  const raw = {
    ...payload([span(1)]),
    scope: { closed: true },
    quality: { coverage: 'complete', orderCoverage: 'complete', attestation: 'raw-claim' },
  };
  const graph = projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: [raw] });
  expect(graph.scope.closed).toBe(false);
  expect(graph.quality).toMatchObject({
    coverage: 'unknown',
    orderCoverage: 'unknown',
    attestation: 'none',
  });
});

test('rejects identical span IDs carrying conflicting instrumentation provenance', () => {
  const first = payload([span(1, { attributes: [attribute('http.request.method', 'POST')] })]);
  const second = structuredClone(first);
  second.resourceSpans[0].scopeSpans[0].scope.name = 'different-producer';
  expect(() =>
    projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: [first, second] }),
  ).toThrow('Conflicting duplicate span records');
});

test('rejects identical span IDs interpreted under different semantic schemas', () => {
  const first = payload([span(1)]);
  const second = {
    resourceSpans: first.resourceSpans.map((resource) => ({
      ...resource,
      schemaUrl: 'https://opentelemetry.io/schemas/1.37.0',
    })),
  };
  expect(() =>
    projectEffects({ format: 'otlp-json', scopeId: 'scope', payloads: [first, second] }),
  ).toThrow('Conflicting duplicate span records');
});

test.each([
  null,
  {},
  { format: 'otlp-protobuf', scopeId: 'scope', payloads: [] },
  { format: 'otlp-json', scopeId: '', payloads: [] },
  { format: 'otlp-json', scopeId: 'scope', payloads: {} },
  { format: 'otlp-json', scopeId: 'scope', payloads: [], closed: true },
  { format: 'otlp-json', scopeId: 'scope', payloads: new Array<unknown>(1) },
])('rejects malformed projection input %j', (input) => {
  expect(() => projectUnknown(input)).toThrow(TypeError);
});

test('rejects non-JSON and cyclic payloads before normalization', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const value of [
    cycle,
    { field: Number.NaN },
    { field: Infinity },
    { field: () => 'hidden' },
    { field: undefined },
  ]) {
    expect(() =>
      projectEffects({
        format: 'otlp-json',
        scopeId: 'scope',
        payloads: [{ ...payload([]), field: value }],
      }),
    ).toThrow(TypeError);
  }
});
