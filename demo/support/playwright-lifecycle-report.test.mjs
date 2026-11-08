import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedLifecycleCases, verifyLifecycleReport } from './playwright-lifecycle-report.mjs';

function report() {
  const cases = expectedLifecycleCases.map(([title, status]) => ({
    title, tests: [{ expectedStatus: status, results: [{ status, errors: status === 'failed' ? [{ message: 'Blackbox state capture failed during this attempt' }] : [] }] }],
  }));
  return { stats: { expected: 4, unexpected: 0, skipped: 0, flaky: 0 }, suites: [
    { title: 'lifecycle.spec.ts', suites: [], specs: cases.slice(0, 3) },
    { title: 'subscriptions.spec.ts', specs: [], suites: [
      { title: 'Rule: accepted subscriptions are retained as active', suites: [], specs: [cases[3]] },
    ] },
  ] };
}
test('requires exact executed lifecycle cases and the capture-specific failure', () => {
  assert.equal(verifyLifecycleReport(report()).length, 4);
  const missing = report(); missing.suites[0].specs.pop();
  assert.throws(() => verifyLifecycleReport(missing));
  const falseFailure = report(); falseFailure.suites[0].specs[2].tests[0].results[0].errors = [{ message: 'unrelated failure' }];
  assert.throws(() => verifyLifecycleReport(falseFailure));
  const skipped = report(); skipped.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.throws(() => verifyLifecycleReport(skipped));
});

test('requires the fourth subscription scenario under its approved rule with one passed attempt', () => {
  for (const change of [
    (value) => { value.suites[1].suites[0].specs = []; },
    (value) => { value.suites[1].suites[0].title = 'Rule: another requirement'; },
    (value) => { value.suites[1].suites[0].specs[0].tests[0].results[0].status = 'skipped'; },
    (value) => { value.suites[1].suites[0].specs[0].tests[0].results.push({ status: 'passed' }); },
    (value) => { value.stats.expected = 3; },
  ]) {
    const value = report();
    change(value);
    assert.throws(() => verifyLifecycleReport(value));
  }
});
