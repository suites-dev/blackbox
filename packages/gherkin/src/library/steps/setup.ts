import { expect } from '@suites/blackbox-playwright';

import { stepDefinitions } from '../../runtime/registry.js';
import { fixture, integerAt, jsonDocString, jsonDocStringProblems, stringAt } from '../support/arguments.js';
import { methodProblems, pathProblems, sendJson } from '../support/http.js';

// Setup through the application (report section 2.8, kind 2). The response is
// checked here and never recorded, so no claim can judge a setup response.

export const setupSteps = stepDefinitions([
  {
    expression: 'the client has sent {word} {string} with JSON and received {int}:',
    kind: 'setup',
    argument: 'doc-string',
    fixtures: ['request', 'sandbox'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the client has sent POST "/subscriptions" with JSON and received 201:',
    check: ({ parameters, argument }) => [
      ...methodProblems(stringAt(parameters, 0)),
      ...pathProblems(stringAt(parameters, 1)),
      ...jsonDocStringProblems(argument),
    ],
    run: async ({ fixtures, parameters, argument }) => {
      const method = stringAt(parameters, 0);
      const path = stringAt(parameters, 1);
      const exchange = await sendJson(fixture(fixtures, 'request'), fixture(fixtures, 'sandbox'), {
        method,
        path,
        json: jsonDocString(argument),
      });
      expect(exchange.status, `setup ${method} ${path} status`).toBe(integerAt(parameters, 2));
    },
  },
]);
