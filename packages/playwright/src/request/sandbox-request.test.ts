import type { APIRequestContext } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import type { RequestEntry } from '../stimulus/summary.js';
import { sandboxRequest } from './sandbox-request.js';

function fake() {
  const calls: string[] = [];
  const target = {
    post: (url: string) => {
      calls.push(url);
      return Promise.resolve({});
    },
    fetch: (url: unknown) => {
      calls.push(typeof url === 'string' ? url : 'request-object');
      return Promise.resolve({});
    },
  } as APIRequestContext;
  return { calls, target };
}

describe('request observation', () => {
  it('reports what the test asked for, before the entrypoint is resolved, and still sends it', async () => {
    const { calls, target } = fake();
    const seen: { entry: RequestEntry; opaque: boolean }[] = [];
    const request = sandboxRequest(
      target,
      () => ({ url: 'http://127.0.0.1:4000', protocol: 'http' }),
      (entry, opaque) => {
        seen.push({ entry, opaque });
      },
    );
    await request.post('/subscriptions', { data: { a: 1 } });
    expect(calls).toEqual(['http://127.0.0.1:4000/subscriptions']);
    expect(seen).toEqual([
      {
        entry: { method: 'POST', url: '/subscriptions', options: { data: { a: 1 } } },
        opaque: false,
      },
    ]);
  });

  it('marks a request object as opaque', async () => {
    const { target } = fake();
    const seen: boolean[] = [];
    const request = sandboxRequest(
      target,
      () => undefined,
      (_entry, opaque) => {
        seen.push(opaque);
      },
    );
    await request.fetch({} as Parameters<APIRequestContext['fetch']>[0]);
    expect(seen).toEqual([true]);
  });
});
