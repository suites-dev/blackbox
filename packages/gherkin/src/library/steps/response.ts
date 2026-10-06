import { expect } from '@suites/blackbox-playwright';

import { stepDefinitions } from '../../runtime/registry.js';
import type { StepFixtures } from '../../runtime/step-types.js';
import { fixture, integerAt, jsonDocString, jsonDocStringProblems, parseJson, stringAt } from '../support/arguments.js';
import { expectPointer, pointerProblems, resolvePointer, type PointerResult } from '../support/json-pointer.js';
import { latestStimulus, singleResponse } from '../support/scenario.js';
import { itemCount } from '../support/state.js';

// Response claims (report section 2.10): native expectations on the responses
// the latest stimulus step recorded. "The response" needs exactly one. Members
// of its JSON body are addressed with JSON Pointer, as state claims address
// theirs, so an API that reports its outcome in the body can be judged by it.

const STATUS_LIST = /^\s*[1-5][0-9]{2}\s*(?:,\s*[1-5][0-9]{2}\s*)*$/u;

function sortedStatuses(statuses: readonly number[]): readonly number[] {
  return [...statuses].sort((left, right) => left - right);
}

/** What the one response's JSON body holds at `pointer`, and how a claim names that place. */
function responseAt(fixtures: StepFixtures, pointer: string): { readonly at: PointerResult; readonly where: string } {
  expectPointer(pointer);
  const response = singleResponse(fixture(fixtures, 'world'));
  const what = `body of ${response.method} ${response.path}`;
  return { at: resolvePointer(parseJson(response.body, what), pointer), where: `${pointer} in the ${what}` };
}

export const responseSteps = stepDefinitions([
  {
    expression: 'the response status is {int}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response status is 201',
    check: null,
    run: ({ fixtures, parameters }) => {
      const response = singleResponse(fixture(fixtures, 'world'));
      expect(response.status, `status of ${response.method} ${response.path}`).toBe(integerAt(parameters, 0));
      return Promise.resolve();
    },
  },
  {
    expression: 'the response statuses are {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response statuses are "201, 409"',
    check: null,
    run: ({ fixtures, parameters }) => {
      const written = stringAt(parameters, 0);
      expect(written, 'statuses as a comma-separated list, such as "201, 409"').toMatch(STATUS_LIST);
      const expected = sortedStatuses(written.split(',').map((status) => Number(status.trim())));
      const actual = sortedStatuses(latestStimulus(fixture(fixtures, 'world')).map((response) => response.status));
      // Concurrent responses arrive in no fixed order, so the statuses compare as a multiset.
      expect(actual, 'statuses of the latest stimulus step, in any order').toEqual(expected);
      return Promise.resolve();
    },
  },
  {
    expression: 'the response JSON equals:',
    kind: 'response-claim',
    argument: 'doc-string',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response JSON equals:',
    check: ({ argument }) => jsonDocStringProblems(argument),
    run: ({ fixtures, argument }) => {
      const response = singleResponse(fixture(fixtures, 'world'));
      const expected = parseJson(jsonDocString(argument), 'the doc string');
      const what = `body of ${response.method} ${response.path}`;
      expect(parseJson(response.body, what), what).toEqual(expected);
      return Promise.resolve();
    },
  },
  {
    expression: 'the response has {string} equal to:',
    kind: 'response-claim',
    argument: 'doc-string',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response has "/subscription/status" equal to:',
    check: ({ parameters, argument }) => [...pointerProblems(stringAt(parameters, 0)), ...jsonDocStringProblems(argument)],
    run: ({ fixtures, parameters, argument }) => {
      const expected = parseJson(jsonDocString(argument), 'the doc string');
      const { at, where } = responseAt(fixtures, stringAt(parameters, 0));
      expect(at, where).toEqual({ found: true, value: expected });
      return Promise.resolve();
    },
  },
  {
    expression: 'the response has {int} item(s) at {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response has 3 items at "/data"',
    check: ({ parameters }) => pointerProblems(stringAt(parameters, 1)),
    run: ({ fixtures, parameters }) => {
      const { at, where } = responseAt(fixtures, stringAt(parameters, 1));
      expect(itemCount(at), `items of the array at ${where}`).toBe(integerAt(parameters, 0));
      return Promise.resolve();
    },
  },
  {
    // Presence, for values the system generates (tokens, IDs): any JSON value except null.
    expression: 'the response has a value at {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response has a value at "/subscription/id"',
    check: ({ parameters }) => pointerProblems(stringAt(parameters, 0)),
    run: ({ fixtures, parameters }) => {
      const { at, where } = responseAt(fixtures, stringAt(parameters, 0));
      expect(at, `a value other than null at ${where}`).toEqual({ found: true, value: expect.anything() });
      return Promise.resolve();
    },
  },
]);
