import type { APIResponse } from '@playwright/test';
import { expect, it, vi } from 'vitest';

import { createMockPage } from '../activities/execution/browser-propagation.mock.fixture.js';
import type { BlackboxScopedRequest } from '../activities/public-types.js';
import { createAttemptEffects } from './attempt-effects.js';
import { withPipeline } from './testing/collector.fixture.js';

function runtime(storageDirectory: string, entrypointUrl = 'http://127.0.0.1:3000') {
  return createAttemptEffects({
    sessionId: 'effects-pipeline-session',
    executionId: 'effects-pipeline-attempt',
    storageDirectory,
    entrypointUrl,
  });
}

it('preserves request options while canonical headers win case-insensitively', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const attempt = runtime(storageDirectory);
    const post = vi.fn().mockResolvedValue({ status: () => 202 } as APIResponse);
    const request = Object.create(null) as BlackboxScopedRequest;
    Object.defineProperty(request, 'post', { value: post });
    const options = {
      data: { sku: 'test' },
      headers: { authorization: 'Bearer test', TraceParent: 'forged' },
      timeout: 4_321,
    };
    const retained: BlackboxScopedRequest[] = [];
    await attempt.activities.stimulus.request('direct request', request, async (scoped) => {
      retained.push(scoped);
      await scoped.post('http://127.0.0.1:3000/orders', options);
    });

    expect(post).toHaveBeenCalledOnce();
    const forwarded = post.mock.calls[0][1];
    const forwardedHeaders = forwarded.headers as Record<string, string>;
    expect(forwarded.data).toEqual({ sku: 'test' });
    expect(forwarded.timeout).toBe(4_321);
    expect(forwardedHeaders.authorization).toBe('Bearer test');
    expect(forwardedHeaders.traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/u);
    expect(
      Object.keys(forwardedHeaders).filter((name) => name.toLowerCase() === 'traceparent'),
    ).toHaveLength(1);
    expect(options.headers).toEqual({ authorization: 'Bearer test', TraceParent: 'forged' });
    await expect(retained[0].post('http://127.0.0.1:3000/escaped')).rejects.toThrow(
      'no longer available after its activity ended',
    );
    expect(post).toHaveBeenCalledOnce();
  });
});

it('routes an activity only for its lifetime and strips its headers at foreign origins', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const attempt = runtime(storageDirectory);
    const mock = createMockPage();
    await attempt.activities.stimulus.browser('browser request', mock.page, async () => {
      await mock.invoke('http://127.0.0.1:3000/orders', {
        cookie: 'session=test',
        traceparent: 'forged',
      });
      const injected = mock.events[0].headers.traceparent;
      await mock.invoke('https://third-party.example/orders', {
        authorization: 'Bearer third-party',
        traceparent: injected,
      });
    });

    expect(mock.events.map(({ kind }) => kind)).toEqual(['fetch', 'fulfill', 'continue']);
    expect(mock.events[0].headers.cookie).toBe('session=test');
    expect(mock.events[0].headers.traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/u);
    expect(mock.events[2].headers).toEqual({ authorization: 'Bearer third-party' });
    expect(mock.registrations).toHaveLength(1);
    expect(mock.unregistrations).toEqual(mock.registrations);
    await expect(mock.invoke('http://127.0.0.1:3000/after', {})).rejects.toThrow(
      'No browser activity route handler',
    );
  });
});

it('removes browser propagation after an action failure', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const mock = createMockPage();
    await expect(
      runtime(storageDirectory).activities.stimulus.browser(
        'failed browser request',
        mock.page,
        () => Promise.reject(new Error('action failed')),
      ),
    ).rejects.toThrow('action failed');
    expect(mock.unregistrations).toEqual(mock.registrations);
  });
});

it('rejects overlapping and nested actions on one page while separate pages remain independent', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const attempt = runtime(storageDirectory);
    const first = createMockPage();
    const second = createMockPage();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = (): void => undefined;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const outer = attempt.activities.setup.browser('outer', first.page, async () => {
      entered();
      await expect(
        attempt.activities.setup.browser('nested', first.page, () => Promise.resolve()),
      ).rejects.toThrow('Overlapping or nested');
      await gate;
    });
    await active;
    await expect(
      attempt.activities.setup.browser('overlap', first.page, () => Promise.resolve()),
    ).rejects.toThrow('Overlapping or nested');
    await attempt.activities.setup.browser('independent', second.page, () => Promise.resolve());
    release();
    await outer;
    expect(first.registrations).toHaveLength(1);
    expect(second.registrations).toHaveLength(1);
  });
});
