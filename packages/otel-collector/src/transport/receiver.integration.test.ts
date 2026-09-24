import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { readCollectorSession, readCollectorTrace } from '../index.js';
import { fragmentDirectory, lifecyclePath } from '../storage/paths.js';
import {
  postJson,
  traceA,
  traceB,
  traceRequest,
  withCollector,
} from '../test-fixtures/collector.js';

it('acknowledges OTLP JSON hex identifiers only after fragments and lifecycle are retained', async () => {
  await withCollector(async ({ input, collector }) => {
    const request = traceRequest();
    const response = await postJson(collector, request);
    expect(response.status, await response.text()).toBe(200);
    const names = await readdir(fragmentDirectory(input));
    expect(names).toEqual(['000000000001.json']);
    const raw: unknown = JSON.parse(
      await readFile(`${fragmentDirectory(input)}/${names[0]}`, 'utf8'),
    );
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('rawJson' in raw) ||
      typeof raw.rawJson !== 'string'
    ) {
      throw new Error('Fragment did not retain raw JSON.');
    }
    expect(JSON.parse(raw.rawJson)).toEqual(request);
    const lifecycle = JSON.parse(await readFile(lifecyclePath(input), 'utf8'));
    expect(lifecycle.telemetry).toMatchObject({ acceptedRequests: 1, acceptedSpans: 2 });
    const session = await readCollectorSession(input);
    expect(session).toMatchObject({ kind: 'collector-session-found', traceIds: [traceA, traceB] });
    const trace = await readCollectorTrace({ ...input, traceId: traceA });
    expect(trace.kind).toBe('collector-trace-found');
    if (trace.kind !== 'collector-trace-found') {
      throw new Error('Trace was not retained');
    }
    expect(trace.fragments[0].request).toMatchObject({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                expect.objectContaining({
                  traceId: traceA,
                  links: [{ traceId: traceB, spanId: 'bbbbbbbbbbbbbbbb', attributes: [] }],
                }),
              ],
            },
          ],
        },
      ],
    });
    const linkedTrace = await readCollectorTrace({ ...input, traceId: traceB });
    expect(linkedTrace).toMatchObject({
      kind: 'collector-trace-found',
      traceId: traceB,
      fragments: [
        { request: { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: traceB }] }] }] } },
      ],
    });
    expect(collector.status().instrumentation).toBe('unknown');
  });
});

it('serializes concurrent acknowledgements without overwriting fragment identities', async () => {
  await withCollector(async ({ input, collector }) => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => postJson(collector, traceRequest())),
    );
    expect(responses.map(({ status }) => status)).toEqual(Array(8).fill(200));
    const session = await readCollectorSession(input);
    expect(session.kind).toBe('collector-session-found');
    if (session.kind !== 'collector-session-found') {
      throw new Error('Session missing');
    }
    expect(session.fragments.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(session.lifecycle.telemetry).toMatchObject({ acceptedRequests: 8, acceptedSpans: 16 });
  });
});

it('accepts gzip JSON while rejecting malformed/compressed-over-limit bodies without poisoning readiness', async () => {
  await withCollector(async ({ collector }) => {
    const headers = { 'content-type': 'application/json', 'content-encoding': 'gzip' };
    const good = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers,
      body: gzipSync(JSON.stringify(traceRequest())),
    });
    expect(good.status).toBe(200);
    const malformed = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers,
      body: 'not gzip',
    });
    expect(malformed.status).toBe(400);
    const oversized = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers,
      body: gzipSync(' '.repeat(4096)),
    });
    expect(oversized.status).toBe(413);
    expect(collector.status()).toMatchObject({
      receiver: 'ready',
      telemetry: { acceptedRequests: 1 },
    });
  });
});

it.each([
  ['POST', '/v1/traces', 'text/plain', '{}', 415],
  ['POST', '/v1/traces', 'application/json', '{', 400],
  ['POST', '/v1/traces', 'application/json', '[]', 400],
  ['POST', '/v1/traces', 'application/json', ' '.repeat(4096), 413],
  ['GET', '/v1/traces', 'application/json', undefined, 405],
  ['GET', '/missing', 'application/json', undefined, 404],
  ['GET', '/status/traces/%zz', 'application/json', undefined, 400],
] as const)('rejects malformed %s %s safely', async (method, path, contentType, body, status) => {
  await withCollector(async ({ collector }) => {
    const response = await fetch(`${collector.endpoint.baseUrl}${path}`, {
      method,
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(status);
    expect(collector.status()).toMatchObject({
      receiver: 'ready',
      telemetry: { status: 'not-received' },
    });
    expect((await postJson(collector, {})).status).toBe(200);
  });
});
