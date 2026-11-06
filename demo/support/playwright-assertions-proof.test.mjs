import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyAssertionReport, verifyAssertionRequests } from './playwright-assertions-proof.mjs';

const accounting = (total, passed, failed = 0) => ({
  total,
  passed,
  failed,
  pending: 0,
  unconsumed: 0,
});
const examples = [
  ['positive', 'passed', [['positive', 'resolved', accounting(2, 2)]]],
  ['empty', 'failed', [['empty', 'empty', accounting(0, 0)]]],
  ['swallowed', 'failed', [['swallowed', 'failed', accounting(1, 0, 1)]]],
  ['soft', 'failed', [['soft', 'failed', accounting(1, 0, 1)]]],
  ['async', 'passed', [['async', 'resolved', accounting(2, 2)]]],
  [
    'isolation',
    'passed',
    [
      ['isolation-positive', 'resolved', accounting(1, 1)],
      ['isolation-empty', 'empty', accounting(0, 0)],
    ],
  ],
];

function fixture() {
  const specs = examples.map(([name, status, records], index) => {
    const owner = {
      testId: `case-${name}`,
      retry: 0,
      workerIndex: index % 2,
      parallelIndex: index % 2,
    };
    const receipts = records.map(([label, code, counts]) => ({
      label,
      owner,
      accounting: counts,
      kind: code === 'resolved' ? 'resolved' : 'rejected',
      ...(code === 'resolved'
        ? { value: name }
        : { code, message: `Blackbox assertion scope ${code}` }),
    }));
    return {
      id: owner.testId,
      title: `assertion accounting: ${name}`,
      tests: [
        {
          expectedStatus: 'passed',
          results: [
            {
              status,
              retry: 0,
              workerIndex: owner.workerIndex,
              parallelIndex: owner.parallelIndex,
              errors: status === 'failed' ? [{ message: receipts[0].message }] : [],
              attachments: receipts.map((receipt) => ({
                name: `assertion-accounting:${receipt.label}`,
                contentType: 'application/json',
                body: Buffer.from(JSON.stringify(receipt)).toString('base64'),
              })),
            },
          ],
        },
      ],
    };
  });
  return {
    config: { version: '1.64.1' },
    errors: [],
    stats: { expected: 3, unexpected: 3, skipped: 0, flaky: 0 },
    suites: [{ specs }],
  };
}

function alterReceipt(report, caseIndex, receiptIndex, change) {
  const attachment =
    report.suites[0].specs[caseIndex].tests[0].results[0].attachments[receiptIndex];
  const receipt = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
  change(receipt);
  attachment.body = Buffer.from(JSON.stringify(receipt)).toString('base64');
}

test('accepts three real passes and three specifically accounted native failures', () => {
  const proof = verifyAssertionReport(fixture(), 1);
  assert.equal(proof.tests, 6);
  assert.equal(proof.scopes.length, 7);
});

for (const [name, mutate] of [
  [
    'zero discovery',
    (report) => {
      report.suites = [];
    },
  ],
  [
    'collection failure',
    (report) => {
      report.errors.push({ message: 'import failed' });
    },
  ],
  [
    'wrong compatibility version',
    (report) => {
      report.config.version = '1.65.0';
    },
  ],
  [
    'expected-failure annotation',
    (report) => {
      report.suites[0].specs[1].tests[0].expectedStatus = 'failed';
    },
  ],
  [
    'hidden retry',
    (report) => {
      report.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
  ],
  [
    'missing public accounting receipt',
    (report) => {
      report.suites[0].specs[1].tests[0].results[0].attachments = [];
    },
  ],
  [
    'unrelated native failure',
    (report) => {
      report.suites[0].specs[1].tests[0].results[0].errors = [{ message: 'request refused' }];
    },
  ],
  [
    'soft failure with no scoped failure',
    (report) =>
      alterReceipt(report, 3, 0, (receipt) => {
        receipt.kind = 'resolved';
      }),
  ],
  [
    'swallowed assertion accepted',
    (report) =>
      alterReceipt(report, 2, 0, (receipt) => {
        receipt.code = 'empty';
      }),
  ],
  [
    'poll samples counted as failures',
    (report) =>
      alterReceipt(report, 4, 0, (receipt) => {
        receipt.accounting.failed = 2;
      }),
  ],
  [
    'borrowed concurrent assertion',
    (report) =>
      alterReceipt(report, 5, 1, (receipt) => {
        receipt.accounting.total = 1;
      }),
  ],
  [
    'foreign attempt receipt',
    (report) =>
      alterReceipt(report, 5, 1, (receipt) => {
        receipt.owner.testId = 'another-test';
      }),
  ],
]) {
  test(`rejects ${name}`, () => {
    const report = fixture();
    mutate(report);
    assert.throws(() => verifyAssertionReport(report, 1), assert.AssertionError);
  });
}

test('a successful native exit cannot substitute for the intentional failure cases', () => {
  assert.throws(() => verifyAssertionReport(fixture(), 0), /must exit 1/u);
});

test('real requests and retried polling are required independently of accounting counters', () => {
  const paths = [
    '/positive',
    '/empty',
    '/swallowed',
    '/soft',
    '/async',
    '/isolation-positive',
    '/isolation-empty',
    '/async-poll',
    '/async-poll',
    '/async-poll',
  ];
  const requests = paths.map((path) => ({ method: 'GET', path }));
  assert.equal(verifyAssertionRequests(requests)['/async-poll'], 3);
  assert.throws(
    () => verifyAssertionRequests(requests.filter(({ path }) => path !== '/empty')),
    /exactly once/u,
  );
  assert.throws(() => verifyAssertionRequests(requests.slice(0, -1)), /did not retry/u);
  assert.throws(
    () => verifyAssertionRequests([...requests, { method: 'POST', path: '/unexpected' }]),
    /Unexpected/u,
  );
});
