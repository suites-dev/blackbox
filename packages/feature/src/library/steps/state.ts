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
import {
  describeSource,
  itemCount,
  readState,
  readStateAt,
  type StateSource,
} from '../support/state.js';

// State claims (report section 2.10): an authoritative read of an inspection
// endpoint with a named credential, then a native expectation. Used as Given
// preconditions and as Then claims; members are addressed with JSON Pointer.

function source(fixtures: StepFixtures, parameters: readonly unknown[]): StateSource {
  return {
    request: fixture(fixtures, 'request'),
    sandbox: fixture(fixtures, 'sandbox'),
    path: stringAt(parameters, 0),
    credential: stringAt(parameters, 1),
    credentials: fixture(fixtures, 'credentials'),
  };
}

export const stateSteps = stepDefinitions([
  {
    expression: 'the state at {string} as {string} equals:',
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: ['credentials', 'request', 'sandbox'],
    requires: null,
    credentialParameter: 1,
    deadlineParameter: null,
    example: 'the state at "/fixture/state" as "fixture-control" equals:',
    check: ({ parameters, argument }) => [
      ...pathProblems(stringAt(parameters, 0)),
      ...jsonDocStringProblems(argument),
    ],
    run: async ({ fixtures, parameters, argument }) => {
      const state = source(fixtures, parameters);
      const expected = parseJson(jsonDocString(argument), 'the doc string');
      expect(await readState(state), describeSource(state)).toEqual(expected);
    },
  },
  {
    expression: 'the state at {string} as {string} has {string} equal to:',
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: ['credentials', 'request', 'sandbox'],
    requires: null,
    credentialParameter: 1,
    deadlineParameter: null,
    example: 'the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:',
    check: ({ parameters, argument }) => [
      ...pathProblems(stringAt(parameters, 0)),
      ...pointerProblems(stringAt(parameters, 2)),
      ...jsonDocStringProblems(argument),
    ],
    run: async ({ fixtures, parameters, argument }) => {
      const state = source(fixtures, parameters);
      const pointer = stringAt(parameters, 2);
      const expected = parseJson(jsonDocString(argument), 'the doc string');
      expect(await readStateAt(state, pointer), `${pointer} in ${describeSource(state)}`).toEqual({
        found: true,
        value: expected,
      });
    },
  },
  {
    expression: 'the state at {string} as {string} has {int} item(s) at {string}',
    kind: 'state-claim',
    argument: 'none',
    fixtures: ['credentials', 'request', 'sandbox'],
    requires: null,
    credentialParameter: 1,
    deadlineParameter: null,
    example: 'the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"',
    check: ({ parameters }) => [
      ...pathProblems(stringAt(parameters, 0)),
      ...pointerProblems(stringAt(parameters, 3)),
    ],
    run: async ({ fixtures, parameters }) => {
      const state = source(fixtures, parameters);
      const pointer = stringAt(parameters, 3);
      const items = itemCount(await readStateAt(state, pointer));
      expect(items, `items of the array at ${pointer} in ${describeSource(state)}`).toBe(
        integerAt(parameters, 2),
      );
    },
  },
]);
