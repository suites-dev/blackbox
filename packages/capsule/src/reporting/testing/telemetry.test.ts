import type { CollectorActivityReadResult } from '@suites/blackbox-otel-collector';
import { describe, expect, it } from 'vitest';
import { createRedactionContext } from '../redaction.js';
import { projectActivityTelemetry } from '../telemetry.js';

const traceId = '11111111111111111111111111111111';
const spanId = '2222222222222222';
const identity = { sessionId: 'quiet-river-ada', executionId: 'execution-1' };
const activityId = 'activity-1';
const attr = (key: string, stringValue: string) => ({ key, value: { stringValue } });

function found(): Extract<
  CollectorActivityReadResult,
  { readonly kind: 'collector-activity-found' }
> {
  const root = {
    traceId,
    spanId,
    kind: 1,
    name: 'client request',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '1100000000',
    status: { code: 1 },
    attributes: [attr('blackbox.activity.id', activityId)],
  };
  const child = {
    ...root,
    spanId: '3333333333333333',
    kind: 3,
    parentSpanId: spanId,
    name: 'GET /orders',
    attributes: [
      attr('http.request.method', 'GET'),
      attr('process.command_line', '/Users/private-person/token'),
      attr('db.statement', 'private SQL'),
      attr('http.request.header.authorization', 'secret-token'),
      attr('url.path', '/orders'),
    ],
    links: [{ traceId: '44444444444444444444444444444444', spanId: '5555555555555555' }],
  };
  return {
    kind: 'collector-activity-found',
    identity,
    activityId,
    traceIds: [traceId],
    fragments: [
      {
        sequence: 1,
        receivedAt: '',
        request: {
          resourceSpans: [
            {
              resource: {
                attributes: [
                  attr('service.name', 'orders-api'),
                  attr('process.executable.path', '/Users/private-person/bin/node'),
                  attr('host.name', 'private-host'),
                ],
              },
              scopeSpans: [
                {
                  spans: [
                    root,
                    child,
                    child,
                    { ...root, traceId: '99999999999999999999999999999999' },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

describe('bounded activity trace projection', () => {
  it('retains downstream spans without an activity attribute, parent/link identity and timing, deduplicating spans in exact linked traces', () => {
    const result = projectActivityTelemetry(found(), createRedactionContext(), traceId);
    expect(result.kind).toBe('available');
    if (result.kind !== 'available') {
      throw new Error('expected available');
    }
    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]).toMatchObject({ spanKind: 'internal' });
    expect(result.spans[1]).toMatchObject({
      traceId,
      parentSpanId: spanId,
      spanKind: 'client',
      service: 'orders-api',
      startTimeUnixNano: '1000000000',
      endTimeUnixNano: '1100000000',
      statusCode: 1,
      links: [{ traceId: '44444444444444444444444444444444', spanId: '5555555555555555' }],
      attributes: [
        { key: 'http.request.method', value: 'GET' },
        { key: 'url.path', value: '/orders' },
      ],
    });
    const json = JSON.stringify(result);
    for (const secret of [
      'private-person',
      'private-host',
      'private SQL',
      'secret-token',
      'process.',
      'host.name',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('preserves missing/corrupt branches and does not interpret empty spans as zero effects', () => {
    expect(
      projectActivityTelemetry(
        { kind: 'collector-activity-missing', identity, activityId, message: 'missing' },
        createRedactionContext(),
        traceId,
      ),
    ).toEqual({ kind: 'unavailable', activityId, reason: 'not-retained' });
    expect(
      projectActivityTelemetry(
        {
          kind: 'collector-activity-corrupt',
          identity,
          activityId,
          error: { name: 'Error', message: '/Users/private-person' },
        },
        createRedactionContext(),
        traceId,
      ),
    ).toEqual({ kind: 'unavailable', activityId, reason: 'corrupt' });
    expect(
      projectActivityTelemetry(
        found(),
        createRedactionContext(),
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toEqual({
      kind: 'unavailable',
      activityId,
      reason: 'not-retained',
    });
  });

  it('uses the execution scope trace as the exact correlation key', () => {
    const result = projectActivityTelemetry(
      { ...found(), traceIds: ['99999999999999999999999999999999'] },
      createRedactionContext(),
      traceId,
    );
    expect(result).toMatchObject({ kind: 'available', activityId });
  });
});

describe('failure causes in the span projection', () => {
  it('keeps exception events, the status message, error.type and url.full without its query', () => {
    const failed = {
      traceId,
      spanId: '6666666666666666',
      kind: 3,
      name: 'GET',
      status: { code: 2, message: 'refused by /Users/private-person/app' },
      attributes: [
        attr('error.type', 'java.net.NoRouteToHostException'),
        attr('url.full', 'http://price:16579/prices/1?token=secret-query#frag'),
      ],
      events: [
        { name: 'log', attributes: [attr('message', 'not an exception')] },
        {
          name: 'exception',
          attributes: [
            attr('exception.type', 'java.net.NoRouteToHostException'),
            attr('exception.message', `No route to host ${'x'.repeat(300)}`),
            attr('exception.stacktrace', 'at private.Stack(Frame.java:1)'),
          ],
        },
      ],
    };
    const result = projectActivityTelemetry(
      {
        ...found(),
        fragments: [
          {
            sequence: 1,
            receivedAt: '',
            request: { resourceSpans: [{ scopeSpans: [{ spans: [failed] }] }] },
          },
        ],
      },
      createRedactionContext(),
      traceId,
    );
    if (result.kind !== 'available') {
      throw new Error('expected available');
    }
    const [span] = result.spans;
    expect(span.statusMessage).toBe('refused by [REDACTED]');
    expect(span.exceptions).toEqual([
      { type: 'java.net.NoRouteToHostException', message: `No route to host ${'x'.repeat(183)}` },
    ]);
    expect(span.attributes).toEqual([
      { key: 'error.type', value: 'java.net.NoRouteToHostException' },
      { key: 'url.full', value: 'http://price:16579/prices/1' },
    ]);
    const json = JSON.stringify(result);
    for (const secret of ['secret-query', 'frag', 'private.Stack', 'not an exception']) {
      expect(json).not.toContain(secret);
    }
  });

  it('records no failure for a span that recorded none', () => {
    const result = projectActivityTelemetry(found(), createRedactionContext(), traceId);
    if (result.kind !== 'available') {
      throw new Error('expected available');
    }
    for (const span of result.spans) {
      expect(span).toMatchObject({ statusMessage: null, exceptions: [] });
    }
  });
});
