import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { request } from '@playwright/test';
import { afterEach, expect, it } from 'vitest';

import { sandboxRequest } from './sandbox-request.js';

const resources: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) {
    await close();
  }
});

async function listener(): Promise<string> {
  const server: Server = createServer((incoming, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        method: incoming.method,
        path: incoming.url,
        trace: incoming.headers.traceparent ?? null,
        custom: incoming.headers['x-user'] ?? null,
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  resources.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an owned TCP listener');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function context() {
  const native = await request.newContext();
  resources.push(() => native.dispose());
  return native;
}

it.each(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'] as const)(
  'offers owned %s dispatch to neutral composition once',
  async (method) => {
    const origin = await listener();
    const seen: string[] = [];
    const wrapped = sandboxRequest(
      await context(),
      () => ({ url: origin, protocol: 'http' }),
      (input) => {
        seen.push(`${input.method} ${input.url}`);
        return input.dispatch({
          ...input.options,
          headers: {
            ...(input.options === undefined ? {} : input.options.headers),
            traceparent: 'synthetic-owned-context',
          },
        });
      },
    );
    const response = await wrapped[method]('/action', { headers: { 'x-user': 'kept' } });
    const expectedMethod = method === 'fetch' ? 'GET' : method.toUpperCase();
    expect(seen).toEqual([`${expectedMethod} ${origin}/action`]);
    expect(response.status()).toBe(200);
    if (method !== 'head') {
      expect(await response.json()).toEqual({
        method: expectedMethod,
        path: '/action',
        trace: 'synthetic-owned-context',
        custom: 'kept',
      });
    }
  },
);

it('keeps unrelated absolute targets out of owned dispatch', async () => {
  const owned = await listener();
  const external = await listener();
  const seen: string[] = [];
  const wrapped = sandboxRequest(
    await context(),
    () => ({ url: owned, protocol: 'http' }),
    (input) => {
      seen.push(input.url);
      return input.dispatch({ ...input.options, headers: { traceparent: 'owned' } });
    },
  );
  expect(await (await wrapped.get(`${external}/outside`)).json()).toEqual({
    method: 'GET',
    path: '/outside',
    trace: null,
    custom: null,
  });
  expect(seen).toEqual([]);
  expect((await (await wrapped.post(`${owned}/inside`)).json()).trace).toBe('owned');
  expect(seen).toEqual([`${owned}/inside`]);
});

it('resolves ownership at dispatch time and preserves native requests without a hook', async () => {
  const first = await listener();
  const second = await listener();
  let selected = first;
  const wrapped = sandboxRequest(await context(), () => ({ url: selected, protocol: 'http' }));
  expect((await wrapped.get('/first')).url()).toBe(`${first}/first`);
  selected = second;
  expect((await wrapped.get('/second')).url()).toBe(`${second}/second`);
});
