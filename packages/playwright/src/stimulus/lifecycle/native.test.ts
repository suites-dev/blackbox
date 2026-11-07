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
    'mixed failed and inconclusive assertions remain failed',
    'concurrent claims remain attributed to their own executions',
    'retains an execution verification handle for ownership checking',
    'a foreign test cannot use an active or expired verification handle',
    'injects the native stimulus fixture and verifies its captured state',
  ]);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0].status).toBe('passed');
  }
  expect(run.report.stats).toMatchObject({ expected: 13, unexpected: 0, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'stimulus-events', value: ['begin', 'precondition', 'action', 'final', 'claim', 'begin', 'action', 'final'] });
}, 60_000);

it('blocks the action for a native soft failure while the native test remains failed', async () => {
  const run = await runAssertions('stimulus-soft.spec.ts');
  expect(run.exitCode).toBe(1);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['soft failing precondition never invokes action', 'soft failure mixed with unavailable evidence remains failed']);
  for (const spec of specs) { expect(spec.tests[0].results[0].status).toBe('failed'); }
  expect(run.report.stats).toMatchObject({ expected: 0, unexpected: 2, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'soft-precondition-blocked', value: 0 });
  expect(run.events).toContainEqual({ kind: 'soft-mixed-failed', value: true });
}, 60_000);

it('records real native timeout as interrupted and retains only initial evidence', async () => {
  const run = await runAssertions('stimulus-timeout.spec.ts');
  expect(run.exitCode).toBe(1);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['native timeout interrupts an action without inventing final state']);
  const result = specs[0].tests[0].results[0];
  expect(result.status).toBe('timedOut');
  const attachment = result.attachments.find(({ name }) => name === 'interrupted-lifecycle');
  if (attachment === undefined || attachment.body === undefined) { throw new Error('Missing interrupted lifecycle evidence'); }
  expect(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'))).toEqual([
    { kind: 'begin' }, { kind: 'action', status: 'interrupted' },
  ]);
}, 60_000);
