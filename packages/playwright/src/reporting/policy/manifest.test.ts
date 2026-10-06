import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FullConfig, FullProject, TestCase } from '@playwright/test/reporter';
import { afterAll, expect, it } from 'vitest';

import { defaultFixturePolicy } from '../../fixture-lifecycle/timeouts.js';
import {
  removeRunDirectories,
  runPolicyFixture as playwright,
  runTimeoutMs,
} from '../../testing/policy/run-playwright.js';
import { capturePolicy } from './manifest.js';

// The runner-policy file keeps only settings that can change a verdict, omits every
// field at its default, and lists a test only when its retries or timeout differ from
// its project's, with only the fields that differ.

afterAll(removeRunDirectories);

const configDir = '/project';

function project(overrides: Partial<FullProject> = {}): FullProject {
  return {
    name: 'e2e',
    retries: 0,
    timeout: 30_000,
    repeatEach: 1,
    grep: /.*/,
    grepInvert: null,
    testDir: configDir,
    testMatch: '**/*.@(spec|test).?(c|m)[jt]s?(x)',
    testIgnore: [],
    ...overrides,
  } as FullProject;
}

function testCase(title: string, retries: number, timeout: number): TestCase {
  return { retries, timeout, titlePath: () => ['', 'e2e', 'a.spec.ts', title] } as TestCase;
}

type CaptureInput = Readonly<
  Partial<{
    config: Partial<FullConfig>;
    project: FullProject;
    tests: readonly TestCase[];
    argv: readonly string[];
  }>
>;

function capture(input: CaptureInput) {
  const projectUnderTest = input.project ?? project();
  const tests = input.tests ?? [testCase('alpha', 0, 30_000)];
  const config = {
    workers: 2,
    globalTimeout: 0,
    grep: /.*/,
    grepInvert: null,
    shard: null,
    projects: [projectUnderTest],
    metadata: { blackboxExpectTimeouts: { e2e: 5000 } },
    argv: ['/usr/bin/node', '/cli.js', 'test', ...(input.argv ?? [])],
    ...input.config,
  } as FullConfig;
  const suite = { suites: [{ project: () => projectUnderTest, allTests: () => [...tests] }] };
  return capturePolicy(config, suite, defaultFixturePolicy, configDir).policy;
}

it('omits every field at its default, keeping workers and the project', () => {
  expect(capture({})).toEqual({ workers: 2, projects: { e2e: {} } });
});

it('keeps each setting that differs from its default', () => {
  const policy = capture({
    config: {
      globalTimeout: 600_000,
      grep: /smoke/u,
      grepInvert: /slow/u,
      shard: { current: 1, total: 2 },
    },
    project: project({
      retries: 2,
      timeout: 60_000,
      grep: /api/u,
      testDir: `${configDir}/tests`,
      testMatch: '**/*.feature.spec.mjs',
      testIgnore: ['**/old/**'],
    }),
    tests: [testCase('alpha', 2, 60_000)],
    argv: ['--grep', 'checkout', '--project', 'e2e'],
  });
  expect(policy).toEqual({
    workers: 2,
    globalTimeout: 600_000,
    grep: '/smoke/u',
    grepInvert: '/slow/u',
    shard: '1/2',
    selection: { grep: 'checkout', projects: ['e2e'] },
    projects: {
      e2e: {
        retries: 2,
        timeout: 60_000,
        grep: '/api/u',
        testDir: 'tests',
        testMatch: '**/*.feature.spec.mjs',
        testIgnore: ['**/old/**'],
      },
    },
  });
});

it('lists a test only when its retries or timeout differ, with only those fields', () => {
  const policy = capture({
    project: project({ retries: 1 }),
    tests: [testCase('same', 1, 30_000), testCase('slow', 1, 90_000), testCase('flaky', 3, 30_000)],
  });
  expect(policy.tests).toEqual({
    'e2e › a.spec.ts › flaky': { retries: 3 },
    'e2e › a.spec.ts › slow': { timeout: 90_000 },
  });
});

it(
  'accepts a deliberate change by copying the written policy file over the baseline',
  async () => {
    const drifted = await playwright(['--list'], { variant: 'test-timeout' });
    expect(drifted.code).toBe(1);
    const accepted = join(drifted.directory, 'accepted.yaml');
    await copyFile(join(drifted.directory, 'blackbox-policy.yaml'), accepted);
    const rerun = await playwright(['--list'], { variant: 'test-timeout', baseline: accepted });
    expect(rerun.code, rerun.stderr).toBe(0);
    expect(rerun.stderr).toContain('(matches)');
    expect(rerun.stderr).toContain('tests: 4 selected; 2 with their own retries or timeout');
  },
  2 * runTimeoutMs,
);
