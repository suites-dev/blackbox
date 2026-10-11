import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

import { request as nativeRequest } from '@playwright/test';

import { sandboxRequest } from '../../request/sandbox-request.js';
import { automaticEffectRequest } from '../attempt-effects.js';
import type { BlackboxEffects } from '../../types.js';
import { operationSpan, type PipelineFixture } from './collector.fixture.js';

export interface ObservedRequest {
  readonly method: string;
  readonly traceparent: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

export async function withObservedRequests(
  pipeline: PipelineFixture,
  effects: BlackboxEffects,
  body: (input: {
    readonly request: ReturnType<typeof sandboxRequest>;
    readonly inspection: Awaited<ReturnType<typeof nativeRequest.newContext>>;
    readonly observed: ObservedRequest[];
    readonly origin: string;
  }) => Promise<void>,
  defaults?: Parameters<typeof nativeRequest.newContext>[0],
): Promise<void> {
  const observed: ObservedRequest[] = [];
  const server = createServer((incoming, response) => {
    const method = incoming.method ?? 'GET';
    const url = incoming.url ?? '/';
    const traceparent =
      typeof incoming.headers.traceparent === 'string' ? incoming.headers.traceparent : undefined;
    observed.push({ method, url, traceparent: traceparent ?? '', headers: incoming.headers });
    const retained =
      traceparent === undefined
        ? Promise.resolve()
        : pipeline.exportSpans([
            operationSpan({
              traceId: traceparent.split('-')[1],
              spanId: randomBytes(8).toString('hex'),
              attributes: { 'http.request.method': method, 'http.route': url },
            }),
          ]);
    retained.then(
      () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ method, url }));
      },
      (error: unknown) => {
        response.writeHead(500);
        response.end(String(error));
      },
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing TCP listener');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const native = await nativeRequest.newContext(defaults);
  try {
    await body({
      request: sandboxRequest(
        native,
        () => ({ url: origin, protocol: 'http' }),
        (input) => automaticEffectRequest(effects, input),
      ),
      inspection: native,
      observed,
      origin,
    });
  } finally {
    await native.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }
}
