import { expect } from '@suites/blackbox-playwright';

import { parseJson, type RequestContext, type Sandbox } from './arguments.js';

/** One request a step sent to the Sandbox entrypoint and the response it received. */
export interface Exchange {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;
}

export interface JsonRequest {
  readonly method: string;
  readonly path: string;
  /** JSON text, sent unchanged. */
  readonly json: string;
}

const JSON_METHOD = /^(?:POST|PUT|PATCH|DELETE)$/u;

/**
 * The absolute URL for a path on the Sandbox entrypoint. Feature text can only
 * address the system under test: a path that resolves to another origin
 * fails, so a credential is never sent anywhere else.
 */
export function entrypointUrl(sandbox: Sandbox, path: string): string {
  expect(path, 'request path (absolute, on the Sandbox entrypoint)').toMatch(/^\/(?!\/)/u);
  const base = new URL(sandbox.entrypoint.url);
  const url = new URL(path, base);
  expect(url.origin, `origin of ${path}`).toBe(base.origin);
  return url.href;
}

interface Outgoing {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: string | null;
}

async function exchange(request: RequestContext, sandbox: Sandbox, outgoing: Outgoing): Promise<Exchange> {
  const { method, path } = outgoing;
  // Redirects are not followed: a claim judges the response the system gave.
  const response = await request.fetch(entrypointUrl(sandbox, path), {
    method,
    headers: { ...outgoing.headers },
    maxRedirects: 0,
    ...(outgoing.data === null ? {} : { data: outgoing.data }),
  });
  return { method, path, status: response.status(), body: await response.text() };
}

/** Sends a JSON request from the client to the Sandbox entrypoint. */
export function sendJson(request: RequestContext, sandbox: Sandbox, input: JsonRequest): Promise<Exchange> {
  expect(input.method, 'HTTP method of a JSON request').toMatch(JSON_METHOD);
  parseJson(input.json, `the JSON body of ${input.method} ${input.path}`);
  return exchange(request, sandbox, {
    method: input.method,
    path: input.path,
    headers: { 'content-type': 'application/json' },
    data: input.json,
  });
}

/** Sends a bodyless GET from the client to the Sandbox entrypoint, without credentials. */
export function sendGet(request: RequestContext, sandbox: Sandbox, path: string): Promise<Exchange> {
  return exchange(request, sandbox, { method: 'GET', path, headers: {}, data: null });
}

/** Reads an inspection endpoint, presenting a credential's headers. */
export function inspect(
  request: RequestContext,
  sandbox: Sandbox,
  path: string,
  headers: Readonly<Record<string, string>>,
): Promise<Exchange> {
  return exchange(request, sandbox, { method: 'GET', path, headers, data: null });
}
