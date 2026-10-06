import { expect } from '@suites/blackbox-playwright';

import type { StepDefinition } from '../../runtime/step-types.js';
import { fixture, jsonDocString, stringAt, tableRecords } from '../support/arguments.js';
import { sendGet, sendJson } from '../support/http.js';
import { recordStimulus } from '../support/scenario.js';

// Stimulus (report section 2.9). Each step records every response it received,
// in order, as the latest stimulus that response claims judge.

const CONCURRENT_COLUMNS = ['method', 'path', 'json'] as const;

export const stimulusSteps = [
  {
    expression: 'the client sends GET {string}',
    kind: 'stimulus',
    argument: 'none',
    fixtures: ['request', 'sandbox', 'world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the client sends GET "/health"',
    run: async ({ fixtures, parameters }) => {
      const exchange = await sendGet(fixture(fixtures, 'request'), fixture(fixtures, 'sandbox'), stringAt(parameters, 0));
      recordStimulus(fixture(fixtures, 'world'), [exchange]);
    },
  },
  {
    expression: 'the client sends {word} {string} with JSON:',
    kind: 'stimulus',
    argument: 'doc-string',
    fixtures: ['request', 'sandbox', 'world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the client sends POST "/subscriptions" with JSON:',
    run: async ({ fixtures, parameters, argument }) => {
      const exchange = await sendJson(fixture(fixtures, 'request'), fixture(fixtures, 'sandbox'), {
        method: stringAt(parameters, 0),
        path: stringAt(parameters, 1),
        json: jsonDocString(argument),
      });
      recordStimulus(fixture(fixtures, 'world'), [exchange]);
    },
  },
  {
    expression: 'the client sends these requests concurrently:',
    kind: 'stimulus',
    argument: 'data-table',
    fixtures: ['request', 'sandbox', 'world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the client sends these requests concurrently:',
    run: async ({ fixtures, argument }) => {
      const rows = tableRecords(argument, CONCURRENT_COLUMNS);
      expect(rows.length, 'requests in a concurrent stimulus').toBeGreaterThanOrEqual(2);
      const request = fixture(fixtures, 'request');
      const sandbox = fixture(fixtures, 'sandbox');
      // Every request is in flight before any response is awaited.
      const exchanges = await Promise.all(
        rows.map((row) =>
          sendJson(request, sandbox, { method: row.method, path: row.path, json: row.json }),
        ),
      );
      recordStimulus(fixture(fixtures, 'world'), exchanges);
    },
  },
] satisfies readonly StepDefinition[];
