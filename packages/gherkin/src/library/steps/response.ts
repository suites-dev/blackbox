import { expect } from '@suites/blackbox-playwright';

import type { StepDefinition } from '../../runtime/step-types.js';
import { fixture, integerAt, jsonDocString, parseJson, stringAt } from '../support/arguments.js';
import { latestStimulus, singleResponse } from '../support/scenario.js';

// Response claims (report section 2.10): native expectations on the responses
// the latest stimulus step recorded. "The response" needs exactly one.

const STATUS_LIST = /^\s*[1-5][0-9]{2}\s*(?:,\s*[1-5][0-9]{2}\s*)*$/u;

function sortedStatuses(statuses: readonly number[]): readonly number[] {
  return [...statuses].sort((left, right) => left - right);
}

export const responseSteps = [
  {
    expression: 'the response status is {int}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the response status is 201',
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
    run: ({ fixtures, argument }) => {
      const response = singleResponse(fixture(fixtures, 'world'));
      const expected = parseJson(jsonDocString(argument), 'the doc string');
      const what = `body of ${response.method} ${response.path}`;
      expect(parseJson(response.body, what), what).toEqual(expected);
      return Promise.resolve();
    },
  },
] satisfies readonly StepDefinition[];
