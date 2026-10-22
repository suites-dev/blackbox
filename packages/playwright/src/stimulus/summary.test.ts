import { describe, expect, it } from 'vitest';

import { stimulusFingerprint, summarizeRequest, type RecordedStimulus } from './summary.js';

const entry = (overrides: Partial<{ method: string; url: string; options: unknown }> = {}) => ({
  method: 'POST',
  url: 'http://127.0.0.1:41000/subscriptions',
  options: {
    data: { userId: 'alice', paymentMethodId: 'pm_1' },
    headers: { 'content-type': 'application/json' },
  },
  ...overrides,
});
const fingerprint = (...entries: ReturnType<typeof entry>[]) => {
  const stimuli = [
    {
      title: 'When',
      requests: entries.map((item) => summarizeRequest(item, 'http://127.0.0.1:41000')),
    },
  ] satisfies RecordedStimulus[];
  return stimulusFingerprint(stimuli, 0);
};

describe('stimulus summary', () => {
  it('does not depend on the random port, on key order or on the injected trace headers', () => {
    const base = fingerprint(entry());
    const moved = [{ ...entry({ url: 'http://127.0.0.1:52000/subscriptions' }) }];
    const other = [
      summarizeRequest(
        entry({
          url: 'http://127.0.0.1:52000/subscriptions',
          options: {
            headers: { traceparent: '00-abc-def-01', 'content-type': 'application/json' },
            data: { paymentMethodId: 'pm_1', userId: 'alice' },
          },
        }),
        'http://127.0.0.1:52000',
      ),
    ];
    expect(stimulusFingerprint([{ title: 'x', requests: other }], 0)).toBe(base);
    expect(moved).toHaveLength(1);
  });

  it('changes when the method, path, query, body or a non-secret header changes', () => {
    const base = fingerprint(entry());
    for (const changed of [
      entry({ method: 'PUT' }),
      entry({ url: 'http://127.0.0.1:41000/subscriptions/1' }),
      entry({ url: 'http://127.0.0.1:41000/subscriptions?a=1' }),
      entry({ options: { data: { userId: 'bob', paymentMethodId: 'pm_1' } } }),
      entry({
        options: {
          data: { userId: 'alice', paymentMethodId: 'pm_1' },
          headers: { 'x-mode': 'fast' },
        },
      }),
    ]) {
      expect(fingerprint(changed)).not.toBe(base);
    }
  });

  it('never stores a credential header value or a body value', () => {
    const summary = summarizeRequest(
      entry({
        options: {
          data: { password: 'hunter2' },
          headers: { authorization: 'Bearer abc', 'x-api-key': 'k' },
        },
      }),
      'http://127.0.0.1:41000',
    );
    expect(summary.headers).toEqual({ authorization: 'secret', 'x-api-key': 'secret' });
    expect(JSON.stringify(summary)).not.toContain('hunter2');
    expect(JSON.stringify(summary)).not.toContain('abc');
  });

  it('separates requests to the entrypoint from requests to other origins', () => {
    expect(summarizeRequest(entry({ url: '/health' }), 'http://127.0.0.1:41000')).toMatchObject({
      target: 'entrypoint',
      path: '/health',
    });
    expect(
      summarizeRequest(entry({ url: 'http://example.test/x' }), 'http://127.0.0.1:41000'),
    ).toMatchObject({ target: 'other-origin' });
  });

  it('has no fingerprint when nothing was sent, or when any request could not be summarized', () => {
    expect(stimulusFingerprint([], 0)).toBeNull();
    expect(stimulusFingerprint([], 1)).toBeNull();
  });
});

describe('stimulus summary of requests that vary', () => {
  it('does not treat a stimulus with an opaque request as equal to another one with the same count', () => {
    const summarized = [
      { title: 'When', requests: [summarizeRequest(entry(), 'http://127.0.0.1:41000')] },
    ] satisfies RecordedStimulus[];
    expect(stimulusFingerprint(summarized, 0)).not.toBeNull();
    expect(stimulusFingerprint(summarized, 1)).toBeNull();
  });

  it('tells requests to different external systems apart and keeps the entrypoint anonymous', () => {
    const to = (url: string) =>
      summarizeRequest(entry({ method: 'GET', url, options: {} }), 'http://127.0.0.1:41000');
    expect(to('https://service-a.test/x')).toMatchObject({
      target: 'other-origin',
      origin: 'https://service-a.test',
    });
    expect(to('https://service-a.test/x').origin).not.toBe(to('https://service-b.test/x').origin);
    expect(to('/x').origin).toBeNull();
    expect(to('http://127.0.0.1:41000/x').origin).toBeNull();
  });

  it('counts Playwright params as part of the request, wherever the query is written', () => {
    const withParams = (params: unknown) =>
      fingerprint(
        entry({ method: 'GET', url: 'http://127.0.0.1:41000/items', options: { params } }),
      );
    const alice = withParams({ user: 'alice' });
    expect(withParams({ user: 'bob' })).not.toBe(alice);
    expect(withParams(new URLSearchParams({ user: 'alice' }))).toBe(alice);
    expect(withParams('user=alice')).toBe(alice);
    const inUrl = fingerprint(
      entry({ method: 'GET', url: 'http://127.0.0.1:41000/items?user=alice', options: {} }),
    );
    expect(inUrl).toBe(alice);
    expect(withParams({ user: 'alice', page: 2 })).not.toBe(alice);
    expect(withParams({})).not.toBe(alice);
  });
});
