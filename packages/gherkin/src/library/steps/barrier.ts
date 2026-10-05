import { expect } from '@suites/blackbox-playwright';

import type { StepDefinition, StepFixtures } from '../../runtime/step-types.js';
import { fixture, integerAt, jsonDocString, parseJson, stringAt } from '../support/arguments.js';
import { latestStimulus } from '../support/scenario.js';
import { describeSource, itemCount, stateProbe, type StateSource } from '../support/state.js';

// Completion barriers (report section 2.11): a barrier is a step, not a timer.
// The synchronous seal declares that the latest stimulus's responses complete
// the flow. A polling barrier waits for a real completion condition, and its
// only deadline is the one the reviewed feature text states; running out of
// time fails the barrier.

function deadlineMilliseconds(seconds: number): number {
  expect(seconds, 'barrier deadline in seconds').toBeGreaterThan(0);
  return seconds * 1000;
}

function source(fixtures: StepFixtures, parameters: readonly unknown[]): StateSource {
  return {
    request: fixture(fixtures, 'request'),
    sandbox: fixture(fixtures, 'sandbox'),
    path: stringAt(parameters, 1),
    credential: stringAt(parameters, 2),
  };
}

export const barrierSteps = [
  {
    expression: 'the flow is sealed by the terminal response(s)',
    kind: 'barrier',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    run: ({ fixtures }) => {
      // Stimulus steps await every response before they finish, so the seal holds once one ran.
      expect(latestStimulus(fixture(fixtures, 'world')).length, 'terminal responses').toBeGreaterThan(0);
      return Promise.resolve();
    },
  },
  {
    expression:
      'the flow is sealed within {int} second(s) when the state at {string} as {string} has {string} equal to:',
    kind: 'barrier',
    argument: 'doc-string',
    fixtures: ['request', 'sandbox'],
    requires: null,
    run: async ({ fixtures, parameters, argument }) => {
      const deadline = deadlineMilliseconds(integerAt(parameters, 0));
      const state = source(fixtures, parameters);
      const pointer = stringAt(parameters, 3);
      const expected = parseJson(jsonDocString(argument), 'the doc string');
      await expect
        .poll(stateProbe(state, pointer), {
          message: `flow sealed when ${pointer} in ${describeSource(state)} equals the doc string`,
          timeout: deadline,
        })
        .toEqual({ status: 200, at: { found: true, value: expected } });
    },
  },
  {
    expression:
      'the flow is sealed within {int} second(s) when the state at {string} as {string} has {int} item(s) at {string}',
    kind: 'barrier',
    argument: 'none',
    fixtures: ['request', 'sandbox'],
    requires: null,
    run: async ({ fixtures, parameters }) => {
      const deadline = deadlineMilliseconds(integerAt(parameters, 0));
      const state = source(fixtures, parameters);
      const pointer = stringAt(parameters, 4);
      const probe = stateProbe(state, pointer);
      await expect
        .poll(async () => itemCount((await probe()).at), {
          message: `flow sealed when ${describeSource(state)} has ${integerAt(parameters, 3)} item(s) at ${pointer}`,
          timeout: deadline,
        })
        .toBe(integerAt(parameters, 3));
    },
  },
] satisfies readonly StepDefinition[];
