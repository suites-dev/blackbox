import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyReport } from './proof.mjs';

function evidence(method = 'POST', path = '/business') {
  const steps = [`When client "api" sends ${method} "${path}"`, 'Then the response status is 200'];
  return {
    model: [{ title: 'Scenario: Request evidence', backgrounds: [], steps }],
    report: {
      errors: [],
      stats: { expected: 1, skipped: 0, flaky: 0, unexpected: 0 },
      suites: [
        {
          specs: [
            {
              id: 'request-id',
              title: 'Scenario: Request evidence',
              tests: [
                {
                  expectedStatus: 'passed',
                  results: [
                    { status: 'passed', retry: 0, steps: steps.map((title) => ({ title })) },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    live: [
      {
        testId: 'request-id',
        status: 'passed',
        retry: 0,
        steps: [
          {
            title: steps[0],
            failed: false,
            assertions: [],
            requests: [{ title: method, subtitle: path, failed: false }],
          },
          {
            title: steps[1],
            failed: false,
            assertions: [{ title: 'expect.toBe', failed: false }],
            requests: [],
          },
        ],
      },
    ],
  };
}

function verify(input) {
  return verifyReport(input.report, input.model, input.live);
}

for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`request proof accepts exact case-insensitive ${method} tokens and rejects wrong methods and substrings`, () => {
    const input = evidence(method);
    const request = input.live[0].steps[0].requests[0];
    for (const title of [
      method,
      method.toLowerCase(),
      method[0] + method.slice(1).toLowerCase(),
      `request.${method.toLowerCase()}`,
      `ß${method}`,
    ]) {
      request.title = title;
      assert.equal(verify(input), 1, title);
    }
    for (const title of [
      method === 'GET' ? 'POST' : 'GET',
      `X${method}`,
      `${method}ER`,
      `${method}_request`,
      `K${method}`,
      `ſ${method}`,
    ]) {
      request.title = title;
      assert.throws(() => verify(input), /Business request .* did not execute/u, title);
    }
  });
}

test('request paths retain literal punctuation rather than regexp semantics', () => {
  const input = evidence('POST', '/objects/[ab]+.json');
  assert.equal(verify(input), 1);
  input.live[0].steps[0].requests[0].subtitle = '/objects/aaaXjson';
  assert.throws(() => verify(input), /Business request .* did not execute/u);
});

test('failed or missing request evidence cannot satisfy the method token proof', () => {
  const input = evidence();
  input.live[0].steps[0].requests[0].failed = true;
  assert.throws(() => verify(input), /Business request .* did not execute/u);
  input.live[0].steps[0].requests = [];
  assert.throws(() => verify(input), /Business request .* did not execute/u);
});
