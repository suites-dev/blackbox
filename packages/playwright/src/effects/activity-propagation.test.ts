import type { APIResponse } from '@playwright/test';
import { expect, it, vi } from 'vitest';

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
