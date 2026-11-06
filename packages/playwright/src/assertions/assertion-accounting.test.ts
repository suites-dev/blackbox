import { expect, it } from 'vitest';

import {
  discovered,
  runAssertions,
} from '../testing/assertion-accounting/native-runner.fixture.js';

it('executes the native assertion compatibility matrix with exact discovery and accounting', async () => {
  const run = await runAssertions('pass.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs).toHaveLength(13);
  expect(run.report.stats).toMatchObject({ expected: 13, unexpected: 0, skipped: 0, flaky: 0 });
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].expectedStatus).toBe('passed');
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0]).toMatchObject({ status: 'passed', retry: 0 });
  }
  expect(run.events).toContainEqual({
    kind: 'sync',
    value: { total: 3, passed: 3, failed: 0, pending: 0, unconsumed: 0 },
  });
}, 60_000);

const negativeGroups = [
  {
    name: 'empty, unsupported and synchronous outcomes',
    titles: [
      'empty callback',
      'missing native completion outcome is unsupported',
      'raw native expect inside scope is unsupported',
      'matcher construction is not an assertion',
      'swallowed synchronous failure',
      'soft failure',
      'configured soft failure',
    ],
  },
  {
    name: 'asynchronous and retried outcomes',
    titles: [
      'swallowed asynchronous failure',
      'swallowed custom matcher failure',
      'swallowed terminal polling failure',
      'swallowed terminal toPass failure',
      'toPass cannot hide a swallowed final iteration failure',
      'toPass cannot hide a soft final iteration failure',
    ],
  },
  {
    name: 'nested, snapshot and ownership outcomes',
    titles: [
      'caught failed child cannot verify parent',
      'swallowed snapshot mismatch',
      'settled but unconsumed asynchronous assertion',
      'pending unawaited asynchronous assertion',
      'foreign released matcher cannot assert in another scope',
      'concurrent soft failure does not contaminate a passing sibling scope',
    ],
  },
] satisfies readonly { readonly name: string; readonly titles: readonly string[] }[];

for (const { name, titles } of negativeGroups) {
  it(`rejects ${name} for the intended reason`, async () => {
    if (name === negativeGroups[0].name) {
      const listing = await runAssertions('failures.spec.ts', [], true);
      const expectedTitles = negativeGroups.flatMap((group) => group.titles);
      expect(expectedTitles).toHaveLength(19);
      expect(new Set(expectedTitles).size).toBe(19);
      expect(listing.exitCode).toBe(0);
      expect(listing.report.errors).toEqual([]);
      expect(discovered(listing.report.suites).map(({ title }) => title)).toEqual(expectedTitles);
    }
    const run = await runAssertions('failures.spec.ts', titles);
    expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
    expect(run.report.errors).toEqual([]);
    const specs = discovered(run.report.suites);
    expect(specs.map(({ title }) => title)).toEqual(titles);
    expect(run.report.stats).toMatchObject({
      expected: 0,
      unexpected: titles.length,
      skipped: 0,
      flaky: 0,
    });
    for (const spec of specs) {
      expect(spec.tests).toHaveLength(1);
      expect(spec.tests[0].expectedStatus).toBe('passed');
      expect(spec.tests[0].results).toHaveLength(1);
      expect(spec.tests[0].results[0]).toMatchObject({ status: 'failed', retry: 0 });
      const expectedCode =
        spec.title.includes('raw native') || spec.title.includes('missing native')
          ? 'unsupported'
          : spec.title.includes('empty') || spec.title.includes('construction')
            ? 'empty'
            : spec.title.includes('foreign')
              ? 'ownership'
              : spec.title.includes('pending unawaited')
                ? 'pending'
                : spec.title.includes('unconsumed')
                  ? 'unconsumed'
                  : 'failed';
      expect(run.events).toContainEqual({
        kind: 'rejected',
        value: expect.objectContaining({ title: spec.title, code: expectedCode }),
      });
    }
    expect(run.events.filter(({ kind }) => kind === 'rejected')).toHaveLength(titles.length);
    expect(run.events.filter(({ kind }) => kind === 'unexpected-success')).toEqual([]);
    if (titles.includes('concurrent soft failure does not contaminate a passing sibling scope')) {
      expect(run.events).toContainEqual({
        kind: 'concurrent-passing',
        value: {
          value: 'left',
          accounting: { total: 1, passed: 1, failed: 0, pending: 0, unconsumed: 0 },
        },
      });
    }
  }, 60_000);
}

it('preserves outside-scope behavior and fails closed for leaked ownership', async () => {
  const run = await runAssertions('ownership.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  expect(discovered(run.report.suites)).toHaveLength(4);
  expect(run.report.stats).toMatchObject({ expected: 2, unexpected: 2, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'outside-scope-native', value: 'completed' });
  expect(run.events).toContainEqual({ kind: 'leak-rejected', value: { code: 'ownership' } });
  expect(run.events.filter(({ kind }) => kind === 'unexpected-leak-success')).toEqual([]);
  expect(run.events).toContainEqual({
    kind: 'pending-scope-started',
    value: 'waiting on owned barrier',
  });
  const pending = discovered(run.report.suites).find(
    ({ title }) => title === 'owner teardown rejects an unjoined scope that is still pending',
  );
  if (pending === undefined) {
    throw new Error('Pending ownership case was not discovered');
  }
  expect(pending.tests[0].results[0].errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('pending') }),
    ]),
  );
}, 60_000);
