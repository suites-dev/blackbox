import { expect as check, it } from 'vitest';

import { expect } from './expect.js';
import { createAttemptEffects, runEffectStimulus } from './attempt-effects.js';
import { withPipeline } from './testing/collector.fixture.js';
import { withObservedRequests } from './testing/request-server.fixture.js';

function attempt(storageDirectory: string) {
  return createAttemptEffects({
    sessionId: 'effects-pipeline-session',
    executionId: 'effects-pipeline-attempt',
    storageDirectory,
  }).effects;
}

it('automatically owns multiple native entrypoint requests with independently generated traces', async () => {
  await withPipeline(async (pipeline) => {
    const effects = attempt(pipeline.storageDirectory);
    await withObservedRequests(pipeline, effects, async ({ request, observed }) => {
      check((await request.post('/first', { data: { value: 'first' } })).ok()).toBe(true);
      await expect(effects).toSatisfy((e) => [
        e.exists(e.http({ method: 'POST', route: '/first' })),
      ]);
      check((await request.put('/second', { data: { value: 'second' } })).ok()).toBe(true);
      await expect(effects).toSatisfy((e) => [
        e.exists(e.http({ method: 'POST', route: '/first' })),
        e.exists(e.http({ method: 'PUT', route: '/second' })),
      ]);
      check(observed).toHaveLength(2);
      check(
        observed.every(({ traceparent }) =>
          /^00-[\da-f]{32}-[\da-f]{16}-01$/u.test(traceparent),
        ),
      ).toBe(true);
      check(new Set(observed.map(({ traceparent }) => traceparent)).size).toBe(2);
    });
  });
});

it('reuses explicit stimulus context and does not complete an automatic child activity', async () => {
  await withPipeline(async (pipeline) => {
    const effects = attempt(pipeline.storageDirectory);
    await withObservedRequests(pipeline, effects, async ({ request, observed }) => {
      await runEffectStimulus(effects, 'explicit action', async ({ headers }) => {
        check((await request.post('/explicit')).ok()).toBe(true);
        check(observed[0].traceparent).toBe(headers.traceparent);
        await check(expect(effects).toSatisfy((e) => [e.exists(e.http())])).rejects.toThrow(
          'No completed stimulus activity',
        );
      });
      await expect(effects).toSatisfy((e) => [e.exists(e.http({ route: '/explicit' }))]);
    });
  });
});

it('does not borrow another effects attempt context during nested request execution', async () => {
  await withPipeline(async (pipeline) => {
    const left = attempt(pipeline.storageDirectory);
    const right = attempt(pipeline.storageDirectory);
    await withObservedRequests(pipeline, right, async ({ request, observed }) => {
      await runEffectStimulus(left, 'other attempt', async ({ headers }) => {
        check((await request.post('/right')).ok()).toBe(true);
        check(observed[0].traceparent).not.toBe(headers.traceparent);
      });
      await expect(right).toSatisfy((e) => [e.exists(e.http({ route: '/right' }))]);
      await check(
        expect(left).toSatisfy((e) => [e.exists(e.http({ route: '/right' }))]),
      ).rejects.toThrow(/inconclusive|not-received/);
    });
  });
});

it('replaces mixed-case caller and native default trace context without losing unrelated headers', async () => {
  await withPipeline(async (pipeline) => {
    const effects = attempt(pipeline.storageDirectory);
    const stale = '00-11111111111111111111111111111111-2222222222222222-01';
    await withObservedRequests(
      pipeline,
      effects,
      async ({ request, observed }) => {
        await request.post('/defaults');
        await runEffectStimulus(effects, 'explicit with caller headers', async ({ headers }) => {
          await request.post('/caller', {
            headers: {
              TraceParent: stale,
              TRACEparent: stale,
              TraceState: 'caller=old',
              'x-caller': 'retained',
            },
          });
          check(observed[1].traceparent).toBe(headers.traceparent);
        });
        for (const observation of observed) {
          check(observation.traceparent).not.toBe(stale);
          check(observation.headers.tracestate).toBe('');
          check(observation.headers['x-default']).toBe('retained');
        }
        check(observed[1].headers['x-caller']).toBe('retained');
        await expect(effects).toSatisfy((e) => [
          e.exists(e.http({ route: '/defaults' })),
          e.exists(e.http({ route: '/caller' })),
        ]);
      },
      {
        extraHTTPHeaders: {
          TraceParent: stale,
          TraceState: 'default=old',
          'x-default': 'retained',
        },
      },
    );
  });
});
