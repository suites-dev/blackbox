import { expect } from '@suites/blackbox-playwright';

import { stepDefinitions } from '../../runtime/registry.js';
import type { StepArgument } from '../../runtime/step-types.js';
import { fixture, jsonDocString, jsonDocStringProblems, jsonProblems, stringAt, tableRecords } from '../support/arguments.js';
import { methodProblems, pathProblems, sendGet, sendJson } from '../support/http.js';
import { recordStimulus } from '../support/scenario.js';

// Stimulus (report section 2.9). Each step records every response it received,
// in order, as the latest stimulus that response claims judge.

const CONCURRENT_COLUMNS = ['method', 'path', 'json'] as const;

/** The compile-time check of a concurrent table: its header row, then each request's method, path and JSON. */
function concurrentProblems(argument: StepArgument): readonly string[] {
  if (argument.kind !== 'data-table') {
    return [];
  }
  const [header = [], ...rows] = argument.rows;
  if (header.join('|') !== CONCURRENT_COLUMNS.join('|')) {
    return [`the data table header row is | ${header.join(' | ')} |; it must be | ${CONCURRENT_COLUMNS.join(' | ')} |`];
  }
  return rows.flatMap(([method = '', path = '', json = ''], index) =>
    [...methodProblems(method), ...pathProblems(path), ...jsonProblems(json, 'the json cell')].map(
      (problem) => `request ${index + 1}: ${problem}`,
    ),
  );
}

export const stimulusSteps = stepDefinitions([
  {
    expression: 'the client sends GET {string}',
    kind: 'stimulus',
    argument: 'none',
    fixtures: ['request', 'sandbox', 'world'],
    requires: null,
    credentialParameter: null,
    deadlineParameter: null,
    example: 'the client sends GET "/health"',
    check: ({ parameters }) => pathProblems(stringAt(parameters, 0)),
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
    check: ({ parameters, argument }) => [
      ...methodProblems(stringAt(parameters, 0)),
      ...pathProblems(stringAt(parameters, 1)),
      ...jsonDocStringProblems(argument),
    ],
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
    check: ({ argument }) => concurrentProblems(argument),
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
]);
