import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedLifecycleCases, verifyLifecycleReport } from './playwright-lifecycle-report.mjs';

function report() {
  return { stats: { expected: 3, unexpected: 0, skipped: 0, flaky: 0 }, suites: [{ suites: [], specs: expectedLifecycleCases.map(([title, status]) => ({
    title, tests: [{ expectedStatus: status, results: [{ status, errors: status === 'failed' ? [{ message: 'Blackbox state capture failed during this attempt' }] : [] }] }],
  })) }] };
}
test('requires exact executed lifecycle cases and the capture-specific failure', () => {
  assert.equal(verifyLifecycleReport(report()).length, 3);
  const missing = report(); missing.suites[0].specs.pop();
  assert.throws(() => verifyLifecycleReport(missing));
  const falseFailure = report(); falseFailure.suites[0].specs[2].tests[0].results[0].errors = [{ message: 'unrelated failure' }];
  assert.throws(() => verifyLifecycleReport(falseFailure));
  const skipped = report(); skipped.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.throws(() => verifyLifecycleReport(skipped));
});
