import assert from 'node:assert/strict';

const counts = (total, passed, failed = 0) => ({
  total,
  passed,
  failed,
  pending: 0,
  unconsumed: 0,
});
const expectations = {
  positive: {
    status: 'passed',
    scopes: { positive: { kind: 'resolved', accounting: counts(2, 2) } },
  },
  empty: {
    status: 'failed',
    scopes: { empty: { kind: 'rejected', code: 'empty', accounting: counts(0, 0) } },
  },
  swallowed: {
    status: 'failed',
    scopes: { swallowed: { kind: 'rejected', code: 'failed', accounting: counts(1, 0, 1) } },
  },
  soft: {
    status: 'failed',
    scopes: { soft: { kind: 'rejected', code: 'failed', accounting: counts(1, 0, 1) } },
  },
  async: { status: 'passed', scopes: { async: { kind: 'resolved', accounting: counts(2, 2) } } },
  isolation: {
    status: 'passed',
    scopes: {
      'isolation-positive': { kind: 'resolved', accounting: counts(1, 1) },
      'isolation-empty': { kind: 'rejected', code: 'empty', accounting: counts(0, 0) },
    },
  },
};

function specsUnder(suites) {
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...specsUnder(suite.suites ?? [])]);
}

function scopeReceipts(attempt) {
  return attempt.attachments
    .filter(({ name }) => name.startsWith('assertion-accounting:'))
    .map((attachment) => {
      assert.equal(attachment.contentType, 'application/json');
      assert.equal(typeof attachment.body, 'string', 'Accounting receipt must be inline');
      const value = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
      assert.equal(attachment.name, `assertion-accounting:${value.label}`);
      return value;
    });
}

function verifyScope(receipt, expected, spec, attempt) {
  assert.equal(receipt.kind, expected.kind, `Wrong scope outcome: ${receipt.label}`);
  assert.deepEqual(receipt.accounting, expected.accounting, `Wrong accounting: ${receipt.label}`);
  assert.deepEqual(
    receipt.owner,
    {
      testId: spec.id,
      retry: 0,
      workerIndex: attempt.workerIndex,
      parallelIndex: attempt.parallelIndex,
    },
    'Accounting receipt belongs to another physical attempt',
  );
  if (expected.kind === 'rejected') {
    assert.equal(receipt.code, expected.code, `Wrong rejection: ${receipt.label}`);
    assert.equal(typeof receipt.message, 'string');
    assert(receipt.message.length > 0, 'Missing public scope error message');
    if (attempt.status === 'failed') {
      assert(
        attempt.errors.some((error) => (error.message ?? '').includes(receipt.message)),
        'The native failure did not come from the accounted scope rejection',
      );
    }
  }
}

/** A nonzero process is accepted only for the three specified scope misuse failures. */
export function verifyAssertionReport(report, exitCode) {
  assert.equal(exitCode, 1, 'The three intentional native failures must exit 1');
  assert.equal(
    report.config.version,
    '1.64.1',
    'Accounting compatibility requires pinned Playwright',
  );
  assert.deepEqual(report.errors, [], 'Unexpected collection or worker errors');
  const specs = specsUnder(report.suites);
  assert.deepEqual(
    specs.map(({ title }) => title).sort(),
    Object.keys(expectations)
      .map((name) => `assertion accounting: ${name}`)
      .sort(),
    'Accounting discovery drift',
  );
  assert.deepEqual(
    {
      expected: report.stats.expected,
      unexpected: report.stats.unexpected,
      skipped: report.stats.skipped,
      flaky: report.stats.flaky,
    },
    { expected: 3, unexpected: 3, skipped: 0, flaky: 0 },
  );
  const scopes = [];
  for (const spec of specs) {
    const expected = expectations[spec.title.slice('assertion accounting: '.length)];
    assert.equal(spec.tests.length, 1, 'Unexpected projects');
    assert.equal(spec.tests[0].expectedStatus, 'passed', 'Do not bless failures with test.fail');
    assert.equal(spec.tests[0].results.length, 1, 'Accounting cases must not retry');
    const attempt = spec.tests[0].results[0];
    assert.equal(attempt.retry, 0);
    assert.equal(attempt.status, expected.status);
    const receipts = scopeReceipts(attempt);
    assert.deepEqual(
      receipts.map(({ label }) => label).sort(),
      Object.keys(expected.scopes).sort(),
    );
    for (const receipt of receipts) {
      verifyScope(receipt, expected.scopes[receipt.label], spec, attempt);
      scopes.push(receipt);
    }
    if (attempt.status === 'passed') assert.deepEqual(attempt.errors, []);
  }
  return { kind: 'playwright-assertion-accounting-proof', tests: specs.length, scopes };
}

export function verifyAssertionRequests(requests) {
  const paths = [
    '/positive',
    '/empty',
    '/swallowed',
    '/soft',
    '/async',
    '/async-poll',
    '/isolation-positive',
    '/isolation-empty',
  ];
  assert(
    requests.every(({ method, path }) => method === 'GET' && paths.includes(path)),
    'Unexpected assertion fixture request',
  );
  const observed = Object.fromEntries(
    paths.map((path) => [path, requests.filter((request) => request.path === path).length]),
  );
  for (const path of paths.filter((path) => path !== '/async-poll')) {
    assert.equal(observed[path], 1, `Real HTTP callback did not execute exactly once: ${path}`);
  }
  assert(observed['/async-poll'] >= 3, 'The asynchronous poll did not retry real HTTP reads');
  return observed;
}
