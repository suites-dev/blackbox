import type { JSONReportSuite } from '@playwright/test/reporter';
import { afterEach, expect, it } from 'vitest';

import {
  cleanupNativeRuns,
  eventsOf,
  eventString,
  runPlaywright,
} from '../testing/system-sandbox-harness/native-runner.js';

afterEach(cleanupNativeRuns);
function specsIn(suites: readonly JSONReportSuite[]): JSONReportSuite['specs'] {
  return suites.flatMap((suite) => [...suite.specs, ...specsIn(suite.suites ?? [])]);
}
it('discovers isolated native scenarios and outline rows, awaits real request fixtures, inherits Backgrounds and reports sibling phases', async () => {
  const run = await runPlaywright({
    configFile: 'gherkin.config.ts',
    testFile: 'gherkin.spec.ts',
    jsonReport: true,
    scenario: 'default',
  });
  expect(run.code, run.output).toBe(0);
  expect(run.reportKind).toBe('json');
  if (run.reportKind !== 'json') {
    throw new Error('missing native report');
  }
  const specs = specsIn(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'Scenario: native async action',
    'Scenario: row alice [users 1]',
    'Scenario: row bob [users 2]',
  ]);
  expect(
    specs
      .flatMap(({ tests }) => tests)
      .flatMap(({ results }) => results)
      .map(({ status }) => status),
  ).toEqual(['passed', 'passed', 'passed']);
  const ids = eventsOf(run, 'start').map((event) => eventString(event, 'executionId'));
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
  for (const kind of ['feature-background', 'rule-background', 'stop']) {
    expect(
      eventsOf(run, kind)
        .map((event) => eventString(event, 'executionId'))
        .sort(),
    ).toEqual([...ids].sort());
  }
  expect(eventsOf(run, 'gherkin-row').map((event) => eventString(event, 'user'))).toEqual([
    'alice',
    'bob',
  ]);
  const phases = specs[0].tests[0].results[0].steps ?? [];
  expect(
    phases
      .filter(({ title }) => /^(?:Given|When|Then|And|But) /u.test(title))
      .map(({ title }) => title),
  ).toEqual([
    'Given feature is ready',
    'Given rule is ready',
    'Given native setup',
    'When native request',
    'Then native response',
    'But attempt is owned',
    'When another phase',
    'Then another assertion',
  ]);
  expect(
    phases
      .flatMap(({ steps }) => steps ?? [])
      .filter(({ title }) => /^(?:When|Then|And|But) /u.test(title)),
  ).toEqual([]);
});

it.each([
  ['async-feature', 'must be synchronous'],
  ['missing-examples', 'requires Given and Examples'],
  ['empty-rows', 'nonempty rows'],
  ['row-keys', 'consistent nonempty keys'],
  ['escaped-rule', 'scope cannot be used'],
  ['late-background', 'must precede Rules'],
])('rejects %s before acquiring a sandbox', async (scenario, message) => {
  const run = await runPlaywright({
    configFile: 'gherkin.config.ts',
    testFile: 'gherkin-invalid.spec.ts',
    jsonReport: true,
    scenario,
  });
  expect(run.code, run.output).toBe(1);
  expect(run.output).toContain(message);
  expect(eventsOf(run, 'start')).toHaveLength(0);
});
