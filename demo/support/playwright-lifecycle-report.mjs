import assert from 'node:assert/strict';

export const expectedLifecycleCases = [
  ['lifecycle: PostgreSQL checkpoints and bound verification', 'passed'],
  ['lifecycle: failed precondition sends no action', 'passed'],
  ['lifecycle: caught capture failure fails the attempt', 'failed'],
];
function specs(suites) {
  return suites.flatMap((suite) => [...suite.specs, ...specs(suite.suites ?? [])]);
}
export function verifyLifecycleReport(report) {
  const cases = specs(report.suites);
  assert.deepEqual(cases.map(({ title }) => title), expectedLifecycleCases.map(([title]) => title));
  for (const [index, spec] of cases.entries()) {
    assert.equal(spec.tests.length, 1);
    assert.equal(spec.tests[0].expectedStatus, expectedLifecycleCases[index][1]);
    assert.equal(spec.tests[0].results.length, 1);
    assert.equal(spec.tests[0].results[0].status, expectedLifecycleCases[index][1]);
  }
  assert.deepEqual(report.stats, { ...report.stats, expected: 3, unexpected: 0, skipped: 0, flaky: 0 });
  const failure = cases[2].tests[0].results[0].errors.map(({ message }) => message).join('\n');
  assert.match(failure, /Blackbox state capture failed during this attempt/);
  return cases;
}
