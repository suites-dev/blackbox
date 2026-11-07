import { expect, it } from 'vitest';

import { discovered, runAssertions } from '../../../testing/assertion-accounting/native-runner.fixture.js';

function executed(run: Awaited<ReturnType<typeof runAssertions>>, titles: readonly string[], status: 'passed' | 'failed') {
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(titles);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].expectedStatus).toBe('passed');
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0]).toMatchObject({ status, retry: 0 });
  }
}

it('executes native emission accounting, ownership and causal matcher claims', async () => {
  const run = await runAssertions('emissions.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  expect(JSON.stringify(run.report)).not.toContain('/declined');
  expect(discovered(run.report.suites)).toHaveLength(5);
  executed(run, [
    'emission matchers count once despite rejected earlier candidates and negated payloads',
    'a recorder cannot supply evidence to a subsequent native test attempt',
    'a caught outer emission failure still rejects its assertion scope',
    'causal and ordinal emission assertions retain one native count each',
    'reviewed observed-effect YAML uses the native snapshot matcher and accounting',
  ], 'passed');
  expect(run.report.stats).toMatchObject({ expected: 5, unexpected: 0, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'emission-accounting', value: { total: 4, passed: 4, failed: 0, pending: 0, unconsumed: 0 } });
  expect(run.events).toContainEqual({ kind: 'emission-order-accounting', value: { total: 2, passed: 2, failed: 0, pending: 0, unconsumed: 0 } });
  expect(run.events).toContainEqual({ kind: 'emission-snapshot-accounting', value: { total: 1, passed: 1, failed: 0, pending: 0, unconsumed: 0 } });
  expect(run.events.map(({ kind }) => kind)).toContain('foreign-emission-rejected');
  expect(run.events.map(({ kind }) => kind)).toContain('emission-caught-rejected');
  const attachments = discovered(run.report.suites).flatMap(({ tests }) => tests.flatMap(({ results }) => results.flatMap(({ attachments }) => attachments)));
  expect(attachments.filter(({ name }) => name === 'blackbox-emissions')).toHaveLength(4);
}, 60_000);

it('requires native failures for soft, unconsumed and changed or missing emission baselines', async () => {
  const run = await runAssertions('emissions-rejections.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  expect(discovered(run.report.suites)).toHaveLength(5);
  executed(run, [
    'soft emission mismatch rejects its scope and native test',
    'an unconsumed emission matcher cannot satisfy its scope',
    'observed-effect YAML rejects multiplicity',
    'observed-effect YAML rejects value',
    'observed-effect YAML rejects missing baseline',
  ], 'failed');
  expect(run.report.stats).toMatchObject({ expected: 0, unexpected: 5, skipped: 0, flaky: 0 });
  expect(run.events.map(({ kind }) => kind)).toEqual(['soft-emission-rejected', 'unconsumed-emission-rejected',
    'emission-snapshot-rejected', 'emission-snapshot-rejected', 'emission-snapshot-rejected']);
  expect(run.events.filter(({ kind }) => kind === 'emission-snapshot-rejected').map(({ value }) => value))
    .toEqual([{ change: 'multiplicity' }, { change: 'value' }, { change: 'missing baseline' }]);
}, 60_000);
