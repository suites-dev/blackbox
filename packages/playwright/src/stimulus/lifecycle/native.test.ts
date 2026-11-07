import { expect, it } from 'vitest';
import { discovered, runAssertions } from '../../testing/assertion-accounting/native-runner.fixture.js';

it('executes lifecycle claims under the native Playwright runner', async () => {
  const run = await runAssertions('stimulus.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'captures exact initial values and binds sequential verification',
    'precondition failures and overlap block the action',
    'capture and action failures preserve only available evidence',
    'foreign handles and invalid runtime titles are rejected',
    'reviewed normalized final state uses native snapshots',
    'unavailable effect coverage records an inconclusive claim',
    'interrupted actions retain initial evidence without a final checkpoint',
    'a caught final capture failure remains visible at fixture teardown',
    'injects the native stimulus fixture and verifies its captured state',
  ]);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0].status).toBe('passed');
  }
  expect(run.report.stats).toMatchObject({ expected: 9, unexpected: 0, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'stimulus-events', value: ['begin', 'precondition', 'action', 'final', 'claim', 'begin', 'action', 'final'] });
}, 60_000);

it('blocks the action for a native soft failure while the native test remains failed', async () => {
  const run = await runAssertions('stimulus-soft.spec.ts');
  expect(run.exitCode).toBe(1);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['soft failing precondition never invokes action']);
  expect(specs[0].tests[0].results[0].status).toBe('failed');
  expect(run.report.stats).toMatchObject({ expected: 0, unexpected: 1, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'soft-precondition-blocked', value: 0 });
}, 60_000);
