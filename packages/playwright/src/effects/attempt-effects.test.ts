import { describe, expect as check, it } from 'vitest';

import { expect } from './expect.js';
import { createAttemptEffects } from './attempt-effects.js';
import { operationSpan, withPipeline } from './testing/collector.fixture.js';

function traceId(traceparent: string): string {
  return traceparent.split('-')[1];
}

describe('public attempt activity integration', () => {
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
});
