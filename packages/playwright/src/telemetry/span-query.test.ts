import type { CollectorSessionReadResult, TraceFragment } from '@suites/blackbox-otel-collector';
import { expect, it } from 'vitest';

import type { AttemptTelemetry } from '../runtime/telemetry-handle.js';
import { decodeSpans } from './otlp-spans.js';
import { spanQueries } from './span-query.js';

const login = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function span(traceId: string, spanId: string, name: string, kind: number | string) {
  return {
    traceId,
    spanId,
    parentSpanId: spanId === '0000000000000001' ? '' : '0000000000000001',
    name,
    kind,
    startTimeUnixNano: '1790000000000000000',
    endTimeUnixNano: 1790000000500000000,
    status: { code: 2 },
    attributes: [
      { key: 'http.route', value: { stringValue: '/api/v1/users/login' } },
      { key: 'http.status_code', value: { intValue: '200' } },
      { key: 'retry', value: { boolValue: false } },
      { key: 'ratio', value: { doubleValue: 0.5 } },
      { key: 'ignored', value: { arrayValue: { values: [] } } },
    ],
  };
}

function fragment(service: string, spans: readonly unknown[], sequence = 1): TraceFragment {
  return {
    sequence,
    receivedAt: '2026-10-02T00:00:00Z',
    request: {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
          scopeSpans: [{ spans }],
        },
      ],
    },
  };
}

const retained = {
  [login]: [
    fragment('ts-auth-service', [span(login, '0000000000000002', 'POST /api/v1/users/login', 2)]),
    // Collectors may retain the same span twice; queries return it once.
    fragment('ts-auth-service', [span(login, '0000000000000002', 'POST /api/v1/users/login', 2)]),
    fragment('ts-user-service', [
      span(login, '0000000000000003', 'SELECT users', 'SPAN_KIND_CLIENT'),
    ]),
  ],
  [other]: [fragment('ts-auth-service', [span(other, '0000000000000001', 'GET /health', 2)])],
} satisfies Record<string, TraceFragment[]>;

function telemetry(session: () => CollectorSessionReadResult['kind']): AttemptTelemetry {
  const identity = { sessionId: 'session', executionId: 'execution' };
  return {
    ...identity,
    inspect: () => Promise.resolve({ kind: 'disabled' as const }),
    read: () => {
      const kind = session();
      if (kind === 'collector-session-corrupt') {
        return Promise.resolve({
          kind,
          identity,
          error: { name: 'SyntaxError', message: 'bad json' },
        });
      }
      if (kind === 'collector-session-missing') {
        return Promise.resolve({ kind, identity, message: 'not yet written' });
      }
      return Promise.resolve({
        kind,
        lifecycle: {
          schemaVersion: 1 as const,
          ...identity,
          revision: 1,
          runs: [],
          telemetry: {
            status: 'not-received' as const,
            acceptedRequests: 0 as const,
            acceptedSpans: 0 as const,
            lastReceivedAt: null,
          },
        },
        fragments: [],
        traceIds: Object.keys(retained),
      });
    },
    readTrace: (traceId: string) =>
      Promise.resolve(
        traceId in retained
          ? {
              kind: 'collector-trace-found' as const,
              identity,
              traceId,
              fragments: retained[traceId as keyof typeof retained],
            }
          : { kind: 'collector-trace-missing' as const, identity, traceId, message: 'none' },
      ),
  };
}

it('decodes OTLP/JSON spans with their service, kind, status and scalar attributes', () => {
  const [server, client] = decodeSpans(retained[login]);
  expect(server).toEqual({
    traceId: login,
    spanId: '0000000000000002',
    parentSpanId: '0000000000000001',
    service: 'ts-auth-service',
    name: 'POST /api/v1/users/login',
    kind: 'server',
    status: 'error',
    startTimeUnixNano: '1790000000000000000',
    endTimeUnixNano: '1790000000500000000',
    attributes: {
      'http.route': '/api/v1/users/login',
      'http.status_code': 200,
      retry: false,
      ratio: 0.5,
    },
  });
  expect(client).toMatchObject({ service: 'ts-user-service', kind: 'client' });
  expect(decodeSpans([fragment('x', [{ name: 'no ids' }, null, 'junk'])])).toEqual([]);
  expect(decodeSpans([{ sequence: 1, receivedAt: '', request: 'junk' }])).toEqual([]);
});

it('filters retained spans by service, name, kind and trace', async () => {
  const queries = spanQueries(telemetry(() => 'collector-session-found'));
  expect(await queries.spans()).toHaveLength(3);
  const servers = await queries.spans({ service: 'ts-auth-service', kind: 'server' });
  expect(servers.map(({ name }) => name).sort()).toEqual([
    'GET /health',
    'POST /api/v1/users/login',
  ]);
  expect(await queries.spans({ name: /^SELECT/u })).toMatchObject([{ service: 'ts-user-service' }]);
  expect(await queries.spans({ traceId: other })).toMatchObject([{ name: 'GET /health' }]);
  expect(await queries.spans({ service: 'ts-auth-service', kind: 'client' })).toEqual([]);
});

it('treats a session without telemetry as empty and refuses corrupt telemetry', async () => {
  await expect(spanQueries(telemetry(() => 'collector-session-missing')).spans()).resolves.toEqual(
    [],
  );
  await expect(spanQueries(telemetry(() => 'collector-session-corrupt')).spans()).rejects.toThrow(
    'Blackbox telemetry is corrupt: bad json',
  );
});

it('waits until a matching span is retained', async () => {
  let reads = 0;
  const queries = spanQueries(
    telemetry(() => (++reads < 3 ? 'collector-session-missing' : 'collector-session-found')),
  );
  const found = await queries.waitForSpan(
    { service: 'ts-auth-service', name: 'POST /api/v1/users/login' },
    { intervalMs: 1 },
  );
  expect(found.spanId).toBe('0000000000000002');
  expect(reads).toBe(3);
});

it('names the query and what was retained when no span matches in time', async () => {
  const queries = spanQueries(telemetry(() => 'collector-session-found'));
  await expect(
    queries.waitForSpan(
      { service: 'ts-order-service', name: /order/u },
      { timeoutMs: 20, intervalMs: 5 },
    ),
  ).rejects.toThrow(
    'No span matched {"service":"ts-order-service","name":"/order/u"} within 20ms; retained: ' +
      'ts-auth-service server POST /api/v1/users/login; ts-user-service client SELECT users; ' +
      'ts-auth-service server GET /health',
  );
});
