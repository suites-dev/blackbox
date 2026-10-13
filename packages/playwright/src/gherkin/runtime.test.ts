import type { TestStepInfo } from '@playwright/test';
import { expect, it, vi } from 'vitest';

import type { BlackboxStep } from '../steps/types.js';
import { createGiven, interpolate } from './runtime.js';
import type { GherkinFixtures, GherkinWhen } from './types.js';

function harness() {
  const events: string[] = [];
  let depth = 0;
  const info = {
    attach: vi.fn(async () => {
      await Promise.resolve();
    }),
    skip: vi.fn(),
    annotations: [],
    titlePath: [],
  } satisfies TestStepInfo;
  const stimulusCalls = vi.fn();
  const step = Object.assign(
    async <Result>(
      title: string,
      body: (info: TestStepInfo) => Result | Promise<Result>,
    ): Promise<Result> => {
      events.push(`${String(depth)}:start:${title}`);
      depth += 1;
      try {
        return await body(info);
      } finally {
        depth -= 1;
        events.push(`${String(depth)}:end:${title}`);
      }
    },
    {
      stimulus: async <Result>(
        _title: string,
        body: (
          scope: {
            readonly activityId: string;
            readonly headers: Readonly<Record<string, string>>;
          },
          info: TestStepInfo,
        ) => Result | Promise<Result>,
      ) => {
        stimulusCalls(_title, body);
        return await body(
          { activityId: 'owned-action', headers: { traceparent: 'owned-trace' } },
          info,
        );
      },
    },
  ) satisfies BlackboxStep;
  // Only the step boundary is consumed by these scheduler tests; real fixtures are exercised by native runner tests.
  const fixtures = {
    step,
    effects: { executionId: 'attempt', sessionId: 'session' },
  } as GherkinFixtures<object>;
  return {
    events,
    stimulusCalls,
    step,
    fixtures,
    Given: createGiven(
      fixtures,
      (title) => title,
      () => true,
    ),
  };
}

it('awaits setup and action while reporting Given, When, Then and And as siblings across phases', async () => {
  const { Given, events } = harness();
  let state = 0;
  await Given('setup', async ({ When }) => {
    await Promise.resolve();
    state = 1;
    await When('first action', async ({ Then, And }) => {
      expect(state).toBe(1);
      await Promise.resolve();
      state = 2;
      await Then('first assertion', () => {
        expect(state).toBe(2);
        state = 3;
      });
      await And('second assertion', () => {
        expect(state).toBe(3);
        state = 4;
      });
    });
    await When('second action', async ({ Then }) => {
      expect(state).toBe(4);
      state = 5;
      await Then('final assertion', () => {
        expect(state).toBe(5);
        state = 6;
      });
    });
  });
  expect(state).toBe(6);
  expect(events).toEqual([
    '0:start:Given setup',
    '0:end:Given setup',
    '0:start:When first action',
    '0:end:When first action',
    '0:start:Then first assertion',
    '0:end:Then first assertion',
    '0:start:And second assertion',
    '0:end:And second assertion',
    '0:start:When second action',
    '0:end:When second action',
    '0:start:Then final assertion',
    '0:end:Then final assertion',
  ]);
});
it('forwards stimulus identity and returns its real asynchronous result', async () => {
  const { Given, stimulusCalls, fixtures } = harness();
  await Given('setup', async ({ When }) => {
    await When('send', async ({ stimulus, Then, effects }) => {
      const response = await stimulus(async ({ headers, activityId }) => {
        await Promise.resolve();
        expect(headers.traceparent).toBe('owned-trace');
        expect(activityId).toBe('owned-action');
        return { status: 201 };
      });
      await Then('accepted', ({ effects: assertionEffects }) => {
        expect(response.status).toBe(201);
        expect(assertionEffects).toBe(effects);
        expect(effects).toBe(fixtures.effects);
      });
    });
  });
  expect(stimulusCalls).toHaveBeenCalledExactlyOnceWith('send', expect.any(Function));
});
it('propagates assertion failures and stops later queued assertions', async () => {
  const { Given } = harness();
  const later = vi.fn();
  await expect(
    Given('setup', async ({ When }) => {
      await When('act', async ({ Then, And }) => {
        await Then('fail', () => {
          throw new Error('semantic failure');
        });
        await And('unreachable', later);
      });
    }),
  ).rejects.toThrow('semantic failure');
  expect(later).not.toHaveBeenCalled();
});
it('revokes escaped When and assertion handles after their callback returns', async () => {
  const { Given } = harness();
  let escapedWhen: GherkinWhen<object, object> | undefined;
  let escapedThen: Parameters<Parameters<GherkinWhen<object, object>>[1]>[0]['Then'] | undefined;
  await Given('setup', async ({ When }) => {
    escapedWhen = When;
    await When('act', async ({ Then }) => {
      escapedThen = Then;
      await Then('check', vi.fn());
    });
  });
  if (escapedWhen === undefined || escapedThen === undefined) {
    throw new Error('missing escaped scopes');
  }
  const when = escapedWhen;
  const then = escapedThen;
  expect(() => when('late', vi.fn())).toThrow('step scope');
  expect(() => then('late', vi.fn())).toThrow('step scope');
});
it('rejects missing phases and And before Then', async () => {
  const { Given } = harness();
  await expect(Given('setup', vi.fn())).rejects.toThrow('requires a When');
  await expect(
    Given('setup', async ({ When }) => {
      await When('act', vi.fn());
    }),
  ).rejects.toThrow('requires a Then');
  await expect(
    Given('setup', async ({ When }) => {
      await When('act', async ({ And }) => {
        await And('check', vi.fn());
      });
    }),
  ).rejects.toThrow('preceding Then');
});
it('interpolates outline tokens without interpreting row values as replacements', () => {
  expect(interpolate('Activate <user> and <user>: <missing>', { user: '$&' })).toBe(
    'Activate $& and $&: <missing>',
  );
});
