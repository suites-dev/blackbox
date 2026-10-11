import { expect as check, it, vi } from 'vitest';

import { expect } from './expect.js';
import { createAttemptEffects, runEffectStimulus } from './attempt-effects.js';
import { closeBlackboxEffects } from './runtime.js';
import { operationSpan, withPipeline } from './testing/collector.fixture.js';

function traceId(traceparent: string): string {
  return traceparent.split('-')[1];
}

it('evaluates completed stimuli and excludes unowned setup and inspection observations', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
    });
    await exportSpans([
      operationSpan({
        traceId: 'a'.repeat(32),
        spanId: '1111111111111111',
        attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'INSERT' },
      }),
    ]);
    await runEffectStimulus(runtime.effects, 'create order', async ({ headers }) => {
      await exportSpans([
        operationSpan({
          traceId: traceId(headers.traceparent),
          spanId: '2222222222222222',
          attributes: { 'http.request.method': 'POST', 'http.route': '/orders' },
        }),
      ]);
    });
    await exportSpans([
      operationSpan({
        traceId: 'b'.repeat(32),
        spanId: '3333333333333333',
        attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'SELECT' },
      }),
    ]);

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
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markExported = (): void => undefined;
    const exported = new Promise<void>((resolve) => {
      markExported = resolve;
    });
    const pending = runEffectStimulus(runtime.effects, 'pending update', async ({ headers }) => {
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
    await runEffectStimulus(runtime.effects, 'completed read', async ({ headers }) => {
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
    });
    await check(
      runEffectStimulus(runtime.effects, 'failed delete', async ({ headers }) => {
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

it('expires retained effects and stimulus execution when the attempt closes', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const runtime = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
    });
    await runEffectStimulus(runtime.effects, 'retained post', async ({ headers }) => {
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
    const action = vi.fn();
    closeBlackboxEffects(runtime.effects);

    await check(runEffectStimulus(runtime.effects, 'expired request', action)).rejects.toThrow(
      'does not provide stimulus execution',
    );
    check(action).not.toHaveBeenCalled();
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
