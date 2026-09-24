import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCollector } from '../index.js';
import type { CollectorHandle, StartCollectorInput } from '../model/types.js';

export const traceA = '11111111111111111111111111111111';
export const traceB = '22222222222222222222222222222222';

export function span(traceId: string, spanId: string): Record<string, unknown> {
  return {
    traceId,
    spanId,
    name: 'HTTP GET',
    kind: 2,
    startTimeUnixNano: '1750000000000000000',
    endTimeUnixNano: '1750000000001000000',
    attributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }],
    droppedAttributesCount: 0,
    events: [],
    links: [],
    status: { code: 1 },
  };
}

export function traceRequest(): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'orders' } }] },
        scopeSpans: [
          {
            scope: { name: 'test-instrumentation', version: '1.0' },
            spans: [
              {
                ...span(traceA, 'aaaaaaaaaaaaaaaa'),
                links: [{ traceId: traceB, spanId: 'bbbbbbbbbbbbbbbb', attributes: [] }],
              },
              span(traceB, 'bbbbbbbbbbbbbbbb'),
            ],
          },
        ],
      },
    ],
  };
}

export interface Fixture {
  readonly input: StartCollectorInput;
  readonly collector: CollectorHandle;
}

export async function withCollector(test: (fixture: Fixture) => Promise<void>): Promise<void> {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'blackbox-collector-test-'));
  const input = {
    kind: 'start-collector',
    storageDirectory,
    sessionId: 'test-session',
    executionId: 'test-execution',
    endpoint: {
      kind: 'http',
      host: '127.0.0.1',
      port: 0,
      tracesPath: '/v1/traces',
      readPath: '/status',
    },
    limits: { maxRequestBytes: 2048, shutdownTimeoutMs: 100 },
  } satisfies StartCollectorInput;
  let collector: CollectorHandle | null = null;
  try {
    collector = await startCollector(input);
    await test({ input, collector });
  } finally {
    if (collector !== null) {
      await collector.close();
    }
    await rm(storageDirectory, { recursive: true, force: true });
  }
}

export async function postJson(collector: CollectorHandle, value: unknown): Promise<Response> {
  return fetch(collector.endpoint.tracesUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}
