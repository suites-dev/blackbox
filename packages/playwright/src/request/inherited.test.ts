import type { APIRequestContext, TestInfo } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { summarizeRequest, type RequestEntry } from '../stimulus/summary.js';
import { hasUnrecordedDefaults, withDefaultHeaders, type RequestDefaults } from './inherited.js';
import { requestFixtureFor } from './request-fixture.js';

const recorded = vi.hoisted(() => [] as { entry: unknown; opaque: boolean }[]);
vi.mock('../effects/attempt-effects.js', () => ({
  recordStimulusRequest: (_effects: unknown, input: { entry: unknown; opaque: boolean }) => {
    recorded.push(input);
  },
}));

const none = {
  extraHTTPHeaders: undefined,
  userAgent: undefined,
  httpCredentials: undefined,
  storageState: undefined,
};
const entry = (headers: unknown): RequestEntry => ({
  method: 'GET',
  url: '/x',
  options: headers === undefined ? undefined : { headers },
});
const headersOf = (value: RequestEntry) => {
  const summary = summarizeRequest(value, null);
  if (summary === null) {
    throw new Error('request not summarized');
  }
  return summary.headers;
};

describe('headers a request context sends by default', () => {
  it('are part of the request, and a call overrides them by name in any case', () => {
    const defaults = { ...none, extraHTTPHeaders: { 'X-Tenant': 'alice', 'x-keep': '1' } };
    const alice = headersOf(withDefaultHeaders(entry(undefined), defaults));
    const bob = headersOf(
      withDefaultHeaders(entry(undefined), {
        ...none,
        extraHTTPHeaders: { 'x-tenant': 'bob', 'x-keep': '1' },
      }),
    );
    const overridden = headersOf(withDefaultHeaders(entry({ 'X-TENANT': 'bob' }), defaults));
    expect(alice['x-tenant']).not.toBe(bob['x-tenant']);
    expect(overridden['x-tenant']).toBe(bob['x-tenant']);
    expect(Object.keys(overridden).sort()).toEqual(['x-keep', 'x-tenant']);
  });

  it('include the context user agent, which an explicit header overrides', () => {
    const mobile = { ...none, userAgent: 'Mobile/1' };
    const desktop = { ...none, userAgent: 'Desktop/1' };
    const sent = (defaults: RequestDefaults, headers?: unknown) =>
      headersOf(withDefaultHeaders(entry(headers), defaults))['user-agent'];
    expect(sent(mobile)).not.toBe(sent(desktop));
    expect(sent(mobile, { 'User-Agent': 'Desktop/1' })).toBe(sent(desktop));
    expect(sent({ ...mobile, extraHTTPHeaders: { 'user-agent': 'Desktop/1' } })).toBe(
      sent(desktop),
    );
  });

  it('leave a request alone when there are none', () => {
    expect(withDefaultHeaders(entry(undefined), none)).toEqual(entry(undefined));
  });

  it('are unrecorded when the context holds credentials or stored cookies', () => {
    expect(hasUnrecordedDefaults(none)).toBe(false);
    expect(
      hasUnrecordedDefaults({ ...none, httpCredentials: { username: 'u', password: 'p' } }),
    ).toBe(true);
    expect(hasUnrecordedDefaults({ ...none, storageState: 'state.json' })).toBe(true);
  });
});

describe('the request fixture', () => {
  it('records the merged headers and flags unrecorded defaults', async () => {
    const testInfo = {} as TestInfo;
    const attempts = new WeakMap<TestInfo, RunningBlackboxAttempt>();
    attempts.set(testInfo, {
      effects: {},
      sandbox: { entrypoint: { url: 'http://127.0.0.1:1', protocol: 'http' } },
    } as RunningBlackboxAttempt);
    const sent: string[] = [];
    const target = {
      get: (url: string) => {
        sent.push(url);
        return Promise.resolve({});
      },
      fetch: (url: unknown) => {
        sent.push(String(url));
        return Promise.resolve({});
      },
    } as APIRequestContext;
    const run = async (extra: {
      extraHTTPHeaders: unknown;
      userAgent: unknown;
      httpCredentials: unknown;
      storageState: unknown;
    }) => {
      await requestFixtureFor(attempts)(
        { request: target, ...extra },
        async (request) => {
          await request.get('/x');
        },
        testInfo,
      );
    };
    await run({ ...none, extraHTTPHeaders: { 'x-tenant': 'alice' } });
    await run({ ...none, storageState: 'state.json' });
    expect(recorded).toMatchObject([
      { entry: { options: { headers: { 'x-tenant': 'alice' } } }, opaque: false },
      { opaque: true },
    ]);
  });
});
