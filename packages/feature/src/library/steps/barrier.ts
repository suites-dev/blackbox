import { expect } from '@suites/blackbox-playwright';

import { stepDefinitions } from '../../runtime/registry.js';
import type { StepFixtures } from '../../runtime/step-types.js';
import {
  fixture,
  integerAt,
  jsonDocString,
  jsonDocStringProblems,
  parseJson,
  stringAt,
} from '../support/arguments.js';
import { pathProblems } from '../support/http.js';
import { pointerProblems } from '../support/json-pointer.js';
import { latestStimulus } from '../support/scenario.js';
import { describeSource, itemCount, stateProbe, type StateSource } from '../support/state.js';

// Completion barriers (report section 2.11): a barrier is a step, not a timer.
// The synchronous seal declares that the latest stimulus's responses complete
// the flow. A polling barrier waits for a real completion condition, and its
// only deadline is the one the reviewed feature text states; running out of
// time fails the barrier.

/** The longest deadline a barrier may state: a longer wait is a mistake in the feature, not a flow. */
export const MAX_DEADLINE_SECONDS = 3600;

/** Why a stated deadline is out of bounds, or nothing. */
function deadlineProblems(seconds: number): readonly string[] {
  return seconds >= 1 && seconds <= MAX_DEADLINE_SECONDS
    ? []
    : [
        `barrier deadline of ${seconds} seconds is not between 1 and ${MAX_DEADLINE_SECONDS} seconds`,
      ];
}

function deadlineMilliseconds(seconds: number): number {
  expect(seconds, 'barrier deadline in seconds').toBeGreaterThan(0);
  expect(seconds, 'barrier deadline in seconds').toBeLessThanOrEqual(MAX_DEADLINE_SECONDS);
  return seconds * 1000;
}

function source(fixtures: StepFixtures, parameters: readonly unknown[]): StateSource {
  return {
    request: fixture(fixtures, 'request'),
    sandbox: fixture(fixtures, 'sandbox'),
    path: stringAt(parameters, 1),
    credential: stringAt(parameters, 2),
    credentials: fixture(fixtures, 'credentials'),
  };
}

export const barrierSteps = stepDefinitions([
  {
    expression: 'the flow is sealed by the terminal response(s)',
    kind: 'barrier',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the flow is sealed by the terminal response',
    check: null,
    run: ({ fixtures }) => {
      // Stimulus steps await every response before they finish, so the seal holds once one ran.
      expect(
        latestStimulus(fixture(fixtures, 'world')).length,
        'terminal responses',
      ).toBeGreaterThan(0);
      return Promise.resolve();
    },
  },
  {
    expression:
      'the flow is sealed within {int} second(s) when the state at {string} as {string} has {string} equal to:',
    kind: 'barrier',
    argument: 'doc-string',
    fixtures: ['credentials', 'request', 'sandbox'],
    requires: null,
    credentialParameter: 2,
    deadlineParameter: 0,
    example:
      'the flow is sealed within 5 seconds when the state at "/fixture/state" as "fixture-control" has "/orders/0/status" equal to:',
    check: ({ parameters, argument }) => [
      ...deadlineProblems(integerAt(parameters, 0)),
      ...pathProblems(stringAt(parameters, 1)),
      ...pointerProblems(stringAt(parameters, 3)),
      ...jsonDocStringProblems(argument),
    ],
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
    fixtures: ['credentials', 'request', 'sandbox'],
    requires: null,
    credentialParameter: 2,
    deadlineParameter: 0,
    example:
      'the flow is sealed within 5 seconds when the state at "/fixture/state" as "fixture-control" has 1 item at "/orders"',
    check: ({ parameters }) => [
      ...deadlineProblems(integerAt(parameters, 0)),
      ...pathProblems(stringAt(parameters, 1)),
      ...pointerProblems(stringAt(parameters, 4)),
    ],
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
]);
