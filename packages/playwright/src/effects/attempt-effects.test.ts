import { expect as check, it, vi } from 'vitest';

import type { BlackboxScopedRequest } from '../activities/public-types.js';
import { expect } from './expect.js';
import { createAttemptEffects } from './attempt-effects.js';
import { closeBlackboxEffects } from './runtime.js';
import { operationSpan, withPipeline } from './testing/collector.fixture.js';

function traceId(traceparent: string): string {
  return traceparent.split('-')[1];
}

it('evaluates completed stimuli and excludes setup and inspection observations', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
      entrypointUrl: 'http://127.0.0.1:3000',
    });
    await runtime.activities.setup.run('seed state', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '1111111111111111',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'INSERT' },
        }),
      ]);
    });
    await runtime.activities.stimulus.run('create order', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '2222222222222222',
          attributes: { 'http.request.method': 'POST', 'http.route': '/orders' },
        }),
      ]);
    });
    await runtime.activities.inspection.run('read state', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '3333333333333333',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'SELECT' },
        }),
      ]);
    });

    await expect(runtime.effects).toSatisfy((e) => [
      e.exists(e.http({ method: 'POST', route: '/orders' })),
    ]);
    await check(
      expect(runtime.effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]),
    ).rejects.toThrow('inconclusive');
    await check(
      expect(runtime.effects).toSatisfy((e) => [e.exists(e.db({ operation: 'SELECT' }))]),
    ).rejects.toThrow('inconclusive');
  });
});

it('keeps an attempt with no registered stimulus inconclusive', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
      entrypointUrl: 'http://127.0.0.1:3000',
    });
    await check(expect(runtime.effects).toSatisfy((e) => [e.exists(e.http())])).rejects.toThrow(
      'No completed stimulus activity',
    );
  });
});

it('selects only completed stimuli and admits them after settlement', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
      entrypointUrl: 'http://127.0.0.1:3000',
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markExported = (): void => undefined;
    const exported = new Promise<void>((resolve) => {
      markExported = resolve;
    });
    const pending = runtime.activities.stimulus.run('pending update', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '4444444444444444',
          attributes: { 'http.request.method': 'PATCH', 'http.route': '/orders/{id}' },
        }),
      ]);
      markExported();
      await gate;
    });
    await exported;
    await runtime.activities.stimulus.run('completed read', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '5555555555555555',
          attributes: { 'http.request.method': 'GET', 'http.route': '/orders/{id}' },
        }),
      ]);
    });

    try {
      await expect(runtime.effects).toSatisfy((e) => [
        e.exists(e.http({ method: 'GET', route: '/orders/{id}' })),
      ]);
      await check(
        expect(runtime.effects).toSatisfy((e) => [
          e.exists(e.http({ method: 'PATCH', route: '/orders/{id}' })),
        ]),
      ).rejects.toThrow('inconclusive');
    } finally {
      release();
      await pending;
    }
    await expect(runtime.effects).toSatisfy((e) => [
      e.exists(e.http({ method: 'PATCH', route: '/orders/{id}' })),
    ]);
  });
});

it('treats a failed but settled stimulus as completed evidence', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
      entrypointUrl: 'http://127.0.0.1:3000',
    });
    await check(
      runtime.activities.stimulus.run('failed delete', async ({ headers }) => {
        await exportSpans([
          operationSpan({
            traceId: traceId(headers.traceparent),
            spanId: '6666666666666666',
            attributes: { 'http.request.method': 'DELETE', 'http.route': '/orders/{id}' },
          }),
        ]);
        throw new Error('application rejected delete');
      }),
    ).rejects.toThrow('application rejected delete');

    await expect(runtime.effects).toSatisfy((e) => [
      e.exists(e.http({ method: 'DELETE', route: '/orders/{id}' })),
    ]);
  });
});

it('expires retained effects and activity handles when the attempt closes', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
      entrypointUrl: 'http://127.0.0.1:3000',
    });
    await runtime.activities.stimulus.run('retained post', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '7777777777777777',
          attributes: { 'http.request.method': 'POST', 'http.route': '/retained' },
        }),
      ]);
    });
    await expect(runtime.effects).toSatisfy((e) => [
      e.exists(e.http({ method: 'POST', route: '/retained' })),
    ]);
    await expect(runtime.effects).not.toSatisfy((e) => [
      e.absent(e.http({ method: 'POST', route: '/retained' })),
    ]);
    const post = vi.fn();
    const request = Object.create(null) as BlackboxScopedRequest;
    Object.defineProperty(request, 'post', { value: post });
    closeBlackboxEffects(runtime.effects);

    await check(
      runtime.activities.stimulus.request('expired request', request, (scoped) =>
        scoped.post('http://127.0.0.1:3000/orders'),
      ),
    ).rejects.toThrow('attempt has expired');
    check(post).not.toHaveBeenCalled();
    await check(
      expect(runtime.effects).toSatisfy((e) => [
        e.exists(e.http({ method: 'POST', route: '/retained' })),
      ]),
    ).rejects.toThrow('no longer available');
    await check(
      expect(runtime.effects).not.toSatisfy((e) => [
        e.absent(e.http({ method: 'POST', route: '/retained' })),
      ]),
    ).rejects.toThrow('no longer available');
  });
});
