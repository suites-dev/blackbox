import assert from 'node:assert/strict';

export const expectedLifecycleCases = [
  ['lifecycle: PostgreSQL checkpoints and bound verification', 'passed'],
  ['lifecycle: failed precondition sends no action', 'passed'],
  ['lifecycle: caught capture failure fails the attempt', 'failed'],
  ['Scenario: Alice subscribes with a valid payment method', 'passed'],
];
function specs(suites, ancestors = []) {
  return suites.flatMap((suite) => {
    const suiteTitles = [...ancestors, suite.title];
    return [...suite.specs.map((spec) => ({ ...spec, suiteTitles })), ...specs(suite.suites ?? [], suiteTitles)];
  });
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
  assert.equal(cases[3].suiteTitles.at(-1), 'Rule: accepted subscriptions are retained as active');
  assert.deepEqual(report.stats, { ...report.stats, expected: 4, unexpected: 0, skipped: 0, flaky: 0 });
  const failure = cases[2].tests[0].results[0].errors.map(({ message }) => message).join('\n');
  assert.match(failure, /Blackbox state capture failed during this attempt/);
  return cases;
}
