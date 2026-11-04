import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyDisjointSandboxes, verifyRefundFailure, verifySandboxes } from './proof.mjs';

function faultEvidence() {
  const title = 'Scenario: A repeated refund retains exactly one refund';
  const background = [
    'Given client "payments" has sent POST "/fixture/reset" with JSON and received 200:',
    'Given client "payments" has sent POST "/v1/payment_intents" with JSON and received 201:',
  ];
  const steps = [
    'When client "payments" sends POST "/v1/refunds" with JSON:',
    'Then the response status is 201',
    '* the response JSON contains these fields:',
    'When client "payments" sends POST "/v1/refunds" with JSON:',
    'Then the response status is 409',
    'And the response JSON contains:',
    'And client "payments" GET "/fixture/state" returns 200 with JSON exactly:',
  ];
  const error = { message: 'expect(received).toEqual(expected) refunds: missing refund_1' };
  const observed = [...background, ...steps].map((title) => {
    const final = title.includes('/fixture/state');
    const request = /(POST|GET) "([^"]+)"/u.exec(title);
    const assertions = [];
    if (/received |status is /u.test(title) || final)
      assertions.push({ title: 'expect.toBe', failed: false });
    if (/JSON contains/u.test(title) || final)
      assertions.push({
        title: 'expect.toEqual',
        failed: final,
        ...(final ? { error: error.message } : {}),
      });
    return {
      title,
      failed: final,
      assertions,
      requests: request ? [{ title: request[1], subtitle: request[2], failed: false }] : [],
    };
  });
  return {
    model: [{ title, backgrounds: [{ steps: background }], steps }],
    live: [{ testId: 'refund-id', status: 'failed', retry: 0, steps: observed }],
    report: {
      errors: [],
      stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              id: 'refund-id',
              title,
              tests: [
                {
                  expectedStatus: 'passed',
                  results: [{ status: 'failed', retry: 0, errors: [error] }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

test('refund control proves successful HTTP creation and deduplication before failed retained state', () => {
  const { report, model, live } = faultEvidence();
  assert.equal(verifyRefundFailure(report, model, live, 1), 1);
  assert.throws(() => verifyRefundFailure(report, model, live, 0), /must fail/u);
});

for (const [name, mutate] of [
  ['collection failure', ({ report }) => report.errors.push({ message: 'import missing' })],
  [
    'early HTTP assertion failure',
    ({ live }) => {
      live[0].steps[3].failed = true;
      live[0].steps[3].assertions[0].failed = true;
    },
  ],
  [
    'no final state request',
    ({ live }) => {
      live[0].steps.at(-1).requests = [];
    },
  ],
  [
    'wrong final matcher',
    ({ live }) => {
      live[0].steps.at(-1).assertions[1].title = 'expect.toContain';
    },
  ],
  [
    'arbitrary teardown failure',
    ({ report }) => {
      report.suites[0].specs[0].tests[0].results[0].errors = [{ message: 'cleanup failed' }];
    },
  ],
  [
    'empty business steps',
    ({ live }) => {
      for (const step of live[0].steps) {
        step.assertions = [];
        step.requests = [];
      }
    },
  ],
  [
    'expected-failure annotation',
    ({ report }) => {
      report.suites[0].specs[0].tests[0].expectedStatus = 'failed';
    },
  ],
  [
    'hidden retry',
    ({ report }) => {
      report.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
  ],
  [
    'skipped scenario',
    ({ report }) => {
      report.stats.skipped = 1;
    },
  ],
  [
    'missing earlier steps',
    ({ live }) => {
      live[0].steps.splice(0, 1);
    },
  ],
]) {
  test(`refund control rejects ${name}`, () => {
    const input = faultEvidence();
    mutate(input);
    assert.throws(
      () => verifyRefundFailure(input.report, input.model, input.live, 1),
      assert.AssertionError,
    );
  });
}

test('failed fault attempt still requires unique completed cleanup and no owned Docker resources', async () => {
  const records = [
    {
      value: {
        sandboxId: 'fault-id',
        projectName: 'fault-project',
        state: 'completed',
        cleanup: 'complete',
        stopReason: 'failed',
      },
    },
  ];
  const reason = { stopReason: 'failed' };
  await verifySandboxes(records, 1, async () => [], reason);
  await assert.rejects(
    verifySandboxes(records, 1, async () => ['container'], reason),
    /resources remain/u,
  );
  records[0].value.cleanup = 'incomplete';
  await assert.rejects(
    verifySandboxes(records, 1, async () => [], reason),
    /cleanup was incomplete/u,
  );
});

test('positive and fault invocations cannot reuse Sandbox or Compose project identities', () => {
  const positive = Array.from({ length: 7 }, (_, index) => ({
    value: { sandboxId: `positive-${index}`, projectName: `project-${index}` },
  }));
  const fault = [{ value: { sandboxId: 'fault-id', projectName: 'fault-project' } }];
  assert.equal(verifyDisjointSandboxes(positive, fault), 8);
  for (const key of ['sandboxId', 'projectName']) {
    const reused = structuredClone(fault);
    reused[0].value[key] = positive[0].value[key];
    assert.throws(() => verifyDisjointSandboxes(positive, reused), /reused across invocations/u);
    const missing = structuredClone(fault);
    delete missing[0].value[key];
    assert.throws(() => verifyDisjointSandboxes(positive, missing), /Missing Sandbox/u);
  }
  assert.throws(() => verifyDisjointSandboxes([], fault), /Both invocations/u);
  assert.throws(() => verifyDisjointSandboxes(positive, []), /Both invocations/u);
});
