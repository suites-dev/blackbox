import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedEffects, proveEffects } from './playwright-effects-proof.mjs';

function report() {
  return {
    stats: { expected: 9, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [
      {
        specs: expectedEffects.map((title) => ({
          title,
          tests: [
            {
              expectedStatus: 'passed',
              results: [
                {
                  status: 'passed',
                  retry: 0,
                  attachments: [
                    {
                      name: 'blackbox-effects',
                      body: Buffer.from(
                        JSON.stringify({
                          evidence: { kind: 'admitted' },
                          assertion: {
                            contract: {},
                            evaluation: 'satisfied',
                            negated: false,
                            outcome: 'passed',
                          },
                        }),
                      ).toString('base64'),
                    },
                  ],
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}

const discovery = expectedEffects.join('\n');
const goldens = Object.fromEntries(
  expectedEffects.map((title) => [
    title,
    [
      {
        contract: {},
        evaluation: 'satisfied',
        negated: false,
        outcome: 'passed',
      },
    ],
  ]),
);
test('effects proof accepts exactly nine clean acceptance attempts', () => {
  assert.equal(proveEffects(report(), discovery, goldens).attempts, 9);
});

for (const [name, mutate, message] of [
  ['missing semantic case', (value) => value.suites[0].specs.pop(), /discovery changed/],
  [
    'unexpected skipped case',
    (value) => {
      value.stats.skipped = 1;
    },
    /pass cleanly/,
  ],
  [
    'retry hidden behind passing status',
    (value) => {
      value.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
    /pass once/,
  ],
  [
    'expected-failure test',
    (value) => {
      value.suites[0].specs[0].tests[0].expectedStatus = 'failed';
    },
    /skipped or retried/,
  ],
  [
    'missing effect attachment',
    (value) => {
      value.suites[0].specs[0].tests[0].results[0].attachments = [];
    },
    /semantic evidence missing/,
  ],
]) {
  test(`effects proof rejects ${name}`, () => {
    const value = report();
    mutate(value);
    assert.throws(() => proveEffects(value, discovery, goldens), message);
  });
}

test('effects proof rejects incomplete list discovery', () => {
  assert.throws(
    () => proveEffects(report(), expectedEffects.slice(1).join('\n'), goldens),
    /list discovery omitted/,
  );
});

test('effects proof rejects admitted evidence with a wrong semantic verdict', () => {
  const value = report();
  value.suites[0].specs[0].tests[0].results[0].attachments[0].body = Buffer.from(
    JSON.stringify({
      evidence: { kind: 'admitted' },
      assertion: {
        contract: {},
        evaluation: 'inconclusive',
        negated: false,
        outcome: 'inconclusive',
      },
    }),
  ).toString('base64');
  assert.throws(() => proveEffects(value, discovery, goldens), /semantic verdicts changed/);
});
