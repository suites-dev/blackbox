import { describe, expect, it } from 'vitest';

import { AttemptStimuli } from './attempt-stimuli.js';

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
