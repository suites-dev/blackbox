import { expect, it } from 'vitest';
import { discovered, runAssertions } from '../../../testing/assertion-accounting/native-runner.fixture.js';

it('rejects unfinished public lifecycle operations and still cleans up', async () => {
  const run = await runAssertions('stimulus-pending.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'pending public stimulus action fails teardown',
    'pending public precondition fails teardown without action',
    'pending public verification fails teardown',
  ]);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].results).toHaveLength(1);
    const result = spec.tests[0].results[0];
    expect(result.status).toBe('failed');
    expect(result.errors.map(({ message }) => message).join('\n')).toContain('Blackbox stimulus lifecycle closed with unfinished operations');
  }
  expect(run.report.stats).toMatchObject({ expected: 0, unexpected: 3, skipped: 0, flaky: 0 });
  expect(run.events.filter(({ kind }) => kind === 'pending-lifecycle-body').map(({ value }) => value)).toEqual([
    { phase: 'action', calls: 1 }, { phase: 'precondition', calls: 0 }, { phase: 'claim', calls: 1 },
  ]);
  expect(run.events.filter(({ kind }) => kind === 'pending-lifecycle-cleanup')).toEqual(
    Array.from({ length: 3 }, () => ({ kind: 'pending-lifecycle-cleanup', value: 'completed' })),
  );
}, 60_000);

it('preserves failed scope issues and pure inconclusive verdicts', async () => {
  const run = await runAssertions('stimulus-verdicts.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'nested scope failures cannot become inconclusive', 'pure inconclusive assertions retain their verdict',
  ]);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0].status).toBe('passed');
  }
  expect(run.report.stats).toMatchObject({ expected: 2, unexpected: 0, skipped: 0, flaky: 0 });
}, 60_000);
