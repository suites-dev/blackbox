import { expect, it } from 'vitest';
import { AttemptStimuli } from './attempt-stimuli.js';

it('bounds the final selection without losing individually owned activities', async () => {
  const attempt = new AttemptStimuli({ sessionId: 'session', executionId: 'execution' });
  const ids: string[] = [];
  for (let index = 0; index < 9; index++) {
    await attempt.run(`activity ${String(index)}`, ({ activityId }) => { ids.push(activityId); });
  }
  expect(attempt.completed()).toMatchObject({ kind: 'partial', omitted: 1, activities: ids.map((activityId) => ({ activityId, purpose: 'stimulus' })), selection: { activities: expect.arrayContaining(ids.slice(1).map((activityId) => expect.objectContaining({ activityId }))) } });
  const selected = attempt.completedActivity(ids[8]);
  expect(selected).toMatchObject({ kind: 'selected', selection: { activities: [{ activityId: ids[8] }] } });
  attempt.close();
});
