import { expect, it } from 'vitest';

import {
  captureAttemptActivity,
  createAttemptEffects,
  runEffectStimulus,
} from '../attempt-effects.js';
import { closeBlackboxEffects } from '../runtime.js';
import { operationSpan, withPipeline } from './collector.fixture.js';

it('captures only one completed activity and rejects foreign or expired activity IDs', async () => {
  await withPipeline(async ({ storageDirectory, exportSpans }) => {
    const { effects } = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory,
    });
    const activities: string[] = [];
    for (const [method, spanId] of [
      ['POST', '1111111111111111'],
      ['GET', '2222222222222222'],
    ]) {
      await runEffectStimulus(effects, method, async ({ activityId, headers }) => {
        activities.push(activityId);
        await exportSpans([
          operationSpan({
            traceId: headers.traceparent.split('-')[1],
            spanId,
            attributes: { 'http.request.method': method, 'http.route': '/orders' },
          }),
        ]);
      });
    }
    const first = await captureAttemptActivity(effects, activities[0]);
    expect(first.capture.identity.activityIds).toEqual([activities[0]]);
    if (first.evidence === null) {
      throw new Error('expected admitted evidence');
    }
    expect(first.evidence.projection.effects.map((effect) => effect.operation)).toContain('POST');
    expect(first.evidence.projection.effects.map((effect) => effect.operation)).not.toContain(
      'GET',
    );
    expect(first.capture.coverage.closed).toBe(false);
    await expect(captureAttemptActivity(effects, 'foreign')).rejects.toThrow('not completed');
    closeBlackboxEffects(effects);
    await expect(captureAttemptActivity(effects, activities[0])).rejects.toThrow(
      'does not provide',
    );
  });
});

it('reports an unavailable collector read as a capture failure', async () => {
  await withPipeline(async ({ storageDirectory }) => {
    const { effects } = createAttemptEffects({
      sessionId: 'effects-pipeline-session',
      executionId: 'effects-pipeline-attempt',
      storageDirectory: `${storageDirectory}/missing`,
    });
    const activityId = await runEffectStimulus(
      effects,
      'missing collector',
      ({ activityId }) => activityId,
    );
    await expect(captureAttemptActivity(effects, activityId)).rejects.toThrow(
      'could not be admitted',
    );
    closeBlackboxEffects(effects);
  });
});
