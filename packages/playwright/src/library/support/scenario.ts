import { expect } from '../../effects/expect.js';

import type { World } from './arguments.js';
import type { Exchange } from './http.js';

// What stimulus steps recorded in this attempt's world. Setup requests are not
// recorded, so a claim can only ever judge a response to a stimulus.

const KEY = '@suites/blackbox-playwright/library/stimuli';

class StimulusLog {
  readonly steps: (readonly Exchange[])[] = [];
}

function stimulusLog(world: World): StimulusLog {
  const existing = world.get(KEY);
  if (existing instanceof StimulusLog) {
    return existing;
  }
  const created = new StimulusLog();
  world.set(KEY, created);
  return created;
}

/** Records the responses of one stimulus step, in the order the step sent them. */
export function recordStimulus(world: World, exchanges: readonly Exchange[]): void {
  stimulusLog(world).steps.push(exchanges);
}

/** The responses of the most recent stimulus step; fails when no stimulus ran. */
export function latestStimulus(world: World): readonly Exchange[] {
  const { steps } = stimulusLog(world);
  expect(steps.length, 'stimulus steps before this step').toBeGreaterThan(0);
  return steps.at(-1) ?? [];
}

/** The one response of the most recent stimulus step. */
export function singleResponse(world: World): Exchange {
  const exchanges = latestStimulus(world);
  expect(
    exchanges.length,
    'responses to the latest stimulus step (use "the response statuses are")',
  ).toBe(1);
  const [only] = exchanges;
  return only;
}
