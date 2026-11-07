import { describe, expect, it } from 'vitest';
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

const entry = (url: string) => ({ method: 'POST', url, options: { data: { n: 1 } } });
const attempt = () => new AttemptStimuli({ sessionId: 'session', executionId: 'execution' });

describe('recorded stimulus requests', () => {
  it('attributes a request to the stimulus that was running and counts the rest as unscoped', async () => {
    const stimuli = attempt();
    stimuli.record(entry('/setup'), 'http://x', false);
    await stimuli.run('When it subscribes', () => {
      stimuli.record(entry('/subscriptions'), 'http://x', false);
      return Promise.resolve();
    });
    const { stimuli: recorded, unscoped, opaque } = stimuli.recorded();
    expect(
      recorded.map(({ title, requests }) => [title, requests.map(({ path }) => path)]),
    ).toEqual([['When it subscribes', ['/subscriptions']]]);
    expect([unscoped, opaque]).toEqual([1, 0]);
  });

  it('keeps concurrent stimuli apart and keeps a stimulus that failed', async () => {
    const stimuli = attempt();
    await Promise.allSettled([
      stimuli.run('first', async () => {
        await Promise.resolve();
        stimuli.record(entry('/a'), 'http://x', false);
      }),
      stimuli.run('second', async () => {
        stimuli.record(entry('/b'), 'http://x', false);
        await Promise.reject(new Error('boom'));
      }),
    ]);
    const byTitle = Object.fromEntries(
      stimuli
        .recorded()
        .stimuli.map(({ title, requests }) => [title, requests.map(({ path }) => path)]),
    );
    expect(byTitle).toEqual({ first: ['/a'], second: ['/b'] });
    expect(stimuli.recorded().opaque).toBe(1);
  });

  it('counts overlapping stimuli as unestablished, since their relative request order is not recorded', async () => {
    const stimuli = attempt();
    await Promise.all([
      stimuli.run('first', () => Promise.resolve()),
      stimuli.run('second', () => Promise.resolve()),
    ]);
    expect(stimuli.recorded().opaque).toBe(1);
  });

  it('does not count stimuli that run one after the other', async () => {
    const stimuli = attempt();
    await stimuli.run('first', () => Promise.resolve());
    await stimuli.run('second', () => Promise.resolve());
    await stimuli.run('third', () => Promise.reject(new Error('boom'))).catch(() => undefined);
    await stimuli.run('fourth', () => Promise.resolve());
    expect(stimuli.recorded().opaque).toBe(0);
  });

  it('counts a request object it cannot summarize instead of ignoring it', async () => {
    const stimuli = attempt();
    await stimuli.run('opaque', () => {
      stimuli.record(entry(''), 'http://x', true);
      return Promise.resolve();
    });
    expect(stimuli.recorded().opaque).toBe(1);
  });
});
