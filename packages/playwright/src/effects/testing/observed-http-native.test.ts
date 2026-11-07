import { expect, it } from 'vitest';
import { discovered, runAssertions } from '../../testing/assertion-accounting/native-runner.fixture.js';

it('waits for HTTP and rejects a missing observation under native Playwright', async () => {
  const run = await runAssertions('capture-observed.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  const cases = discovered(run.report.suites);
  expect(cases.map(({ title }) => title)).toEqual([
    'delayed HTTP observation returns the exact successful cut',
    'missing HTTP observation times out instead of snapshotting empty',
  ]);
  for (const item of cases) {
    expect(item.tests).toHaveLength(1);
    expect(item.tests[0].results).toHaveLength(1);
    expect(item.tests[0].results[0].status).toBe('passed');
  }
  expect(run.report.stats).toMatchObject({ expected: 2, unexpected: 0, skipped: 0, flaky: 0 });
}, 60_000);
