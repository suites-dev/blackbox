import type { Page, Request, Route } from '@playwright/test';
import { expect, it, vi } from 'vitest';

import type { BlackboxScopedRequest } from '../activities/public-types.js';
import { createAttemptEffects } from './attempt-effects.js';
import { withPipeline } from './testing/collector.fixture.js';

it('injects canonical request headers and limits browser routing to the entrypoint origin', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
      entrypointUrl: 'http://127.0.0.1:3000',
    });
    const post = vi.fn().mockResolvedValue({ status: () => 202 });
    const request = Object.create(null) as BlackboxScopedRequest;
    Object.defineProperty(request, 'post', { value: post });
    await runtime.activities.stimulus.request('direct request', request, (scoped) =>
      scoped.post('http://127.0.0.1:3000/orders', {
        headers: { authorization: 'Bearer test', traceparent: 'forged' },
      }),
    );
    const directHeaders = post.mock.calls[0][1].headers as Record<string, string>;
    expect(directHeaders.authorization).toBe('Bearer test');
    expect(directHeaders.traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/u);
    expect(directHeaders.traceparent).not.toBe('forged');

    let matches = (_url: URL): boolean => false;
    let handler: Parameters<Page['route']>[1] = () => undefined;
    const route = vi.fn((candidate, candidateHandler) => {
      if (typeof candidate !== 'function') {
        throw new Error('Expected an origin predicate');
      }
      matches = candidate;
      handler = candidateHandler;
      return Promise.resolve();
    });
    const unroute = vi.fn().mockResolvedValue(undefined);
    const page = Object.create(null) as Page;
    Object.defineProperties(page, { route: { value: route }, unroute: { value: unroute } });
    const continued = vi.fn().mockResolvedValue(undefined);
    const routeValue = Object.create(null) as Route;
    const requestValue = Object.create(null) as Request;
    Object.defineProperty(routeValue, 'continue', { value: continued });
    Object.defineProperty(requestValue, 'headers', {
      value: () => ({ cookie: 'session=test', traceparent: 'forged' }),
    });
    await runtime.activities.stimulus.browser('browser request', page, async () => {
      await handler(routeValue, requestValue);
    });
    expect(matches(new URL('http://127.0.0.1:3000/orders'))).toBe(true);
    expect(matches(new URL('https://third-party.example/orders'))).toBe(false);
    const browserHeaders = continued.mock.calls[0][0].headers as Record<string, string>;
    expect(browserHeaders.cookie).toBe('session=test');
    expect(browserHeaders.traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/u);
    expect(unroute).toHaveBeenCalledOnce();
  });
});
