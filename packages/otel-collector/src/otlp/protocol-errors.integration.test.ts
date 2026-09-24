import { expect, it } from 'vitest';
import { postJson, span, traceA, traceRequest, withCollector } from '../test-fixtures/collector.js';

function requestWithSpan(value: unknown): unknown {
  return { resourceSpans: [{ scopeSpans: [{ spans: [value] }] }] };
}

const invalidRequests = [
  { name: 'resource array', request: { resourceSpans: {} } },
  { name: 'resource value', request: { resourceSpans: [null] } },
  { name: 'scope value', request: { resourceSpans: [{ scopeSpans: [null] }] } },
  { name: 'span value', request: requestWithSpan(null) },
  {
    name: 'base64 trace identifier',
    request: requestWithSpan({
      ...span(traceA, 'aaaaaaaaaaaaaaaa'),
      traceId: Buffer.from(traceA, 'hex').toString('base64'),
    }),
  },
  {
    name: 'zero trace identifier',
    request: requestWithSpan(span('0'.repeat(32), 'aaaaaaaaaaaaaaaa')),
  },
  { name: 'zero span identifier', request: requestWithSpan(span(traceA, '0'.repeat(16))) },
  {
    name: 'invalid parent span',
    request: requestWithSpan({ ...span(traceA, 'aaaaaaaaaaaaaaaa'), parentSpanId: 'bad' }),
  },
  {
    name: 'invalid span name',
    request: requestWithSpan({ ...span(traceA, 'aaaaaaaaaaaaaaaa'), name: 42 }),
  },
  {
    name: 'invalid link value',
    request: requestWithSpan({ ...span(traceA, 'aaaaaaaaaaaaaaaa'), links: [null] }),
  },
  {
    name: 'invalid link identity',
    request: requestWithSpan({
      ...span(traceA, 'aaaaaaaaaaaaaaaa'),
      links: [{ traceId: 'bad', spanId: 'bbbbbbbbbbbbbbbb' }],
    }),
  },
] satisfies readonly { readonly name: string; readonly request: unknown }[];

it.each(invalidRequests)(
  'rejects $name without accepting or poisoning the next valid request',
  async ({ request }) => {
    await withCollector(async ({ collector }) => {
      expect((await postJson(collector, request)).status).toBe(400);
      expect(collector.status()).toMatchObject({
        receiver: 'ready',
        telemetry: { acceptedRequests: 0 },
      });
      expect((await postJson(collector, traceRequest())).status).toBe(200);
      expect(collector.status().telemetry.acceptedSpans).toBe(2);
    });
  },
);

it('supports uppercase hex and parent identity without changing retained payload spelling', async () => {
  await withCollector(async ({ collector }) => {
    const value = requestWithSpan({
      ...span('A'.repeat(32), 'B'.repeat(16)),
      parentSpanId: 'C'.repeat(16),
    });
    expect((await postJson(collector, value)).status).toBe(200);
    const trace = await fetch(`${collector.endpoint.readUrl}/traces/${'a'.repeat(32)}`);
    expect(trace.status).toBe(200);
    expect(await trace.json()).toMatchObject({
      kind: 'collector-trace-found',
      fragments: [{ request: value }],
    });
  });
});

it('serves status/session/trace views and reports absent traces without marking the receiver failed', async () => {
  await withCollector(async ({ collector }) => {
    expect((await fetch(collector.endpoint.readUrl)).status).toBe(200);
    const session = await fetch(`${collector.endpoint.readUrl}/session`);
    expect(await session.json()).toMatchObject({ kind: 'collector-session-found', traceIds: [] });
    expect((await fetch(`${collector.endpoint.readUrl}/traces/${traceA}`)).status).toBe(404);
    expect((await fetch(collector.endpoint.readUrl, { method: 'POST' })).status).toBe(405);
    const unsupported = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      body: '{}',
    });
    expect(unsupported.status).toBe(415);
    expect(collector.status().receiver).toBe('ready');
  });
});
