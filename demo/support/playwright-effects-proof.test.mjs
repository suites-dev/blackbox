import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedEffects, proveEffects } from './playwright-effects-proof.mjs';
import { expectedEmissionVerdicts } from './playwright-effects-proof-emissions.mjs';

const observedSnapshot = '"schemaVersion": 1\n"kind": "recorded-effect-observations"\n';

function emissionAttachments(title) {
  const identity = {
    captureId: `capture:${title}`,
    scopeId: `scope:${title}`,
    sessionId: `session:${title}`,
    executionId: `execution:${title}`,
    activityIds: ['stimulus'],
  };
  const emissions = expectedEmissionVerdicts[title].map((assertion, index) => ({
    name: 'blackbox-emissions',
    body: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        assertion: { ...assertion, sequence: index + 1 },
        assessment: {
          identity,
          coverage: { closed: false, coverage: 'unknown' },
          status: assertion.evaluation,
          evidence: ['observed'],
          possibleEvidence: [],
        },
        evidence: {
          kind: 'admitted',
          selection: identity,
          projection: { scope: { id: identity.scopeId }, effects: [{ id: 'observed' }] },
        },
      }),
    ).toString('base64'),
  }));
  return title === 'forbidden database activity produces a definite matcher failure'
    ? [
        ...emissions,
        {
          name: 'blackbox-observed-effects.yaml',
          body: Buffer.from(observedSnapshot).toString('base64'),
        },
      ]
    : emissions;
}

function report() {
  return {
    stats: { expected: 8, unexpected: 0, flaky: 0, skipped: 0 },
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
                    ...emissionAttachments(title),
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
test('effects proof accepts eight attempts, 29 emission verdicts and reviewed YAML', () => {
  const proof = proveEffects(report(), discovery, goldens, observedSnapshot);
  assert.equal(proof.attempts, 8);
  assert.equal(proof.emissionAssertions, 29);
  assert.equal(proof.snapshots.length, 1);
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
    assert.throws(() => proveEffects(value, discovery, goldens, observedSnapshot), message);
  });
}

test('effects proof rejects incomplete list discovery', () => {
  assert.throws(
    () => proveEffects(report(), expectedEffects.slice(1).join('\n'), goldens, observedSnapshot),
    /list discovery omitted/,
  );
});

test('effects proof rejects admitted evidence with a wrong semantic verdict', () => {
  const value = report();
  value.suites[0].specs[0].tests[0].results[0].attachments.find(
    ({ name }) => name === 'blackbox-effects',
  ).body = Buffer.from(
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
  assert.throws(
    () => proveEffects(value, discovery, goldens, observedSnapshot),
    /semantic verdicts changed/,
  );
});

function mutateEmission(value, mutate, position = 0) {
  const attachments = value.suites[0].specs[0].tests[0].results[0].attachments;
  const attachment = attachments.filter(({ name }) => name === 'blackbox-emissions')[position];
  const record = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
  mutate(record);
  attachment.body = Buffer.from(JSON.stringify(record)).toString('base64');
}

for (const [name, mutate, message] of [
  [
    'missing recorder assertion',
    (value) => value.suites[0].specs[0].tests[0].results[0].attachments.shift(),
    /Emission semantic verdicts changed/,
  ],
  [
    'incomplete evidence blessed as passed',
    (value) =>
      mutateEmission(
        value,
        (record) => {
          record.assertion.outcome = 'passed';
        },
        3,
      ),
    /Emission semantic verdicts changed/,
  ],
  [
    'repeated assertion sequence',
    (value) =>
      mutateEmission(
        value,
        (record) => {
          record.assertion.sequence = 1;
        },
        1,
      ),
    /sequence was reused/,
  ],
  [
    'unknown evidence occurrence',
    (value) =>
      mutateEmission(value, (record) => {
        record.assessment.evidence = ['missing'];
      }),
    /unknown occurrence/,
  ],
  [
    'foreign attempt evidence',
    (value) =>
      mutateEmission(value, (record) => {
        record.evidence.selection.executionId = 'foreign';
      }),
    /another attempt/,
  ],
  [
    'manufactured complete coverage',
    (value) =>
      mutateEmission(value, (record) => {
        record.assessment.coverage = { closed: true, coverage: 'complete' };
      }),
    /claimed complete coverage/,
  ],
  [
    'missing positive witness',
    (value) =>
      mutateEmission(value, (record) => {
        record.assessment.evidence = [];
      }),
    /no witness/,
  ],
  [
    'missing YAML evidence',
    (value) => {
      value.suites[0].specs[1].tests[0].results[0].attachments = emissionAttachments(
        expectedEffects[1],
      )
        .filter(({ name }) => name !== 'blackbox-observed-effects.yaml')
        .concat(
          value.suites[0].specs[1].tests[0].results[0].attachments.filter(
            ({ name }) => name === 'blackbox-effects',
          ),
        );
    },
    /YAML evidence missing/,
  ],
]) {
  test(`effects proof rejects ${name}`, () => {
    const value = report();
    mutate(value);
    assert.throws(() => proveEffects(value, discovery, goldens, observedSnapshot), message);
  });
}

test('effects proof rejects changed or missing reviewed YAML', () => {
  assert.throws(
    () => proveEffects(report(), discovery, goldens, `${observedSnapshot}changed: true\n`),
    /reviewed baseline/,
  );
  assert.throws(() => proveEffects(report(), discovery, goldens), /reviewed baseline/);
});

test('effects proof rejects an execution identity reused by another test attempt', () => {
  const value = report();
  const firstExecution = `execution:${expectedEffects[0]}`;
  for (const attachment of value.suites[0].specs[1].tests[0].results[0].attachments) {
    if (attachment.name !== 'blackbox-emissions') continue;
    const record = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    record.assessment.identity.executionId = firstExecution;
    record.evidence.selection.executionId = firstExecution;
    attachment.body = Buffer.from(JSON.stringify(record)).toString('base64');
  }
  assert.throws(
    () => proveEffects(value, discovery, goldens, observedSnapshot),
    /identity reused across attempts/,
  );
});
