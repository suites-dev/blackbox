import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  jsonReport,
  policyFixture,
  removeRunDirectories,
  runPolicyFixture as playwright,
  runTimeoutMs,
  type Run,
} from '../../testing/policy/run-playwright.js';

const testTimeoutMs = 2 * runTimeoutMs;

afterAll(removeRunDirectories);

interface DriftCase {
  readonly change: string;
  readonly args: readonly string[];
  readonly variant: string;
  readonly differences: readonly unknown[];
}

const driftCases = [
  {
    change: 'config retries',
    variant: 'retries',
    args: [],
    differences: [
      'policy.projects.primary.retries: baseline 1, effective 2',
      'policy.projects.secondary.retries: baseline 1, effective 2',
    ],
  },
  {
    change: '--retries',
    variant: 'baseline',
    args: ['--retries=3'],
    differences: [
      'policy.projects.primary.retries: baseline 1, effective 3',
      'policy.projects.secondary.retries: baseline 1, effective 3',
    ],
  },
  {
    change: 'config timeout',
    variant: 'timeout',
    args: [],
    differences: [
      'policy.projects.primary.timeout: not in baseline, effective 45000',
      'policy.projects.secondary.timeout: not in baseline, effective 45000',
    ],
  },
  {
    change: '--timeout',
    variant: 'baseline',
    args: ['--timeout=999'],
    differences: [
      'policy.projects.primary.timeout: not in baseline, effective 999',
      'policy.projects.secondary.timeout: not in baseline, effective 999',
    ],
  },
  {
    // A test that sets its own timeout is listed; tests at their project's settings are not.
    change: 'a test timeout',
    variant: 'test-timeout',
    args: [],
    differences: [
      'policy.tests: not in baseline, effective {"primary › policy.spec.ts › beta":{"timeout":60000},"secondary › policy.spec.ts › beta":{"timeout":60000}}',
    ],
  },
  {
    change: 'expect timeout',
    variant: 'expect-timeout',
    args: [],
    differences: [
      'policy.projects.primary.expectTimeout: not in baseline, effective 9000',
      'policy.projects.secondary.expectTimeout: not in baseline, effective 9000',
    ],
  },
  {
    change: 'config projects',
    variant: 'projects',
    args: [],
    differences: [
      expect.stringMatching(
        /^policy\.projects\.secondary: baseline \{.*\}, not in effective policy$/u,
      ),
    ],
  },
  {
    change: '--project',
    variant: 'baseline',
    args: ['--project=primary'],
    differences: ['policy.selection: not in baseline, effective {"projects":["primary"]}'],
  },
  {
    change: 'config grep',
    variant: 'grep',
    args: [],
    differences: [
      'policy.grep: not in baseline, effective "/alpha/u"',
      'policy.projects.primary.grep: not in baseline, effective "/alpha/u"',
      'policy.projects.secondary.grep: not in baseline, effective "/alpha/u"',
    ],
  },
  {
    change: '--grep',
    variant: 'baseline',
    args: ['--grep=alpha'],
    differences: ['policy.selection: not in baseline, effective {"grep":"alpha"}'],
  },
  {
    // F17: a CLI grep that still selects every test changes no test entry, so only the
    // recorded selection can surface it.
    change: '--grep that selects every test',
    variant: 'baseline',
    args: ['-g', '.'],
    differences: ['policy.selection: not in baseline, effective {"grep":"."}'],
  },
  {
    change: '--grep-invert that excludes no test',
    variant: 'baseline',
    args: ['--grep-invert', 'no such test'],
    differences: ['policy.selection: not in baseline, effective {"grepInvert":"no such test"}'],
  },
  {
    change: 'a file filter that selects every test',
    variant: 'baseline',
    args: ['policy.spec.ts'],
    differences: [
      'policy.selection: not in baseline, effective {"testFilters":["policy.spec.ts"]}',
    ],
  },
  {
    // FullConfig.rootDir follows testDir, so testDir is recorded from the config directory.
    change: 'config testDir',
    variant: 'test-dir',
    args: [],
    differences: [
      'policy.projects.primary.testDir: baseline "tests", not in effective policy',
      'policy.projects.secondary.testDir: baseline "tests", not in effective policy',
    ],
  },
  {
    change: '--shard',
    variant: 'baseline',
    args: ['--shard=1/2'],
    differences: ['policy.shard: not in baseline, effective "1/2"'],
  },
] satisfies DriftCase[];

function expectDrift(run: Run, input: DriftCase): void {
  expect(run.code, run.stderr).toBe(1);
  expect(run.stderr).toContain('baseline: ./baseline.yaml differs');
  const printed = run.stderr.split('\n').map((line) => line.trim());
  expect(printed).toEqual(expect.arrayContaining([...input.differences]));
  expect(run.stderr).toMatch(
    new RegExp(
      `Blackbox runner policy verification failed: ${input.differences.length} difference\\(s\\) from baseline \\./baseline\\.yaml`,
      'u',
    ),
  );
}

it(
  'prints the effective policy, attaches it to each attempt, and passes on the baseline',
  async () => {
    const run = await playwright([]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toContain('Blackbox runner policy');
    expect(run.stderr).toContain('run: workers=1');
    expect(run.stderr).toContain(
      'project "primary": retries=1 testDir="tests" testMatch="policy.spec.ts"',
    );
    expect(run.stderr).toContain("tests: 4 selected; all use their project's retries and timeout");
    expect(run.stderr).toContain('selection: none on the command line');
    expect(run.stderr).toContain('baseline: ./baseline.yaml (matches)');
    expect(run.stderr).not.toContain('verification failed');
    // stdout stays the native reporters' own output.
    expect(run.stdout).not.toContain('Blackbox runner policy');

    const baseline = parse(await readFile(join(policyFixture, 'baseline.yaml'), 'utf8')) as {
      policy: unknown;
    };
    const writtenText = await readFile(join(run.directory, 'blackbox-policy.yaml'), 'utf8');
    const written = parse(writtenText) as { argv: string[]; policy: unknown };
    expect(written.policy).toEqual(baseline.policy);
    expect(written.argv).toContain('test');
    // Only settings that can change a verdict, and only away from their defaults.
    for (const omitted of [
      'timeout',
      'expectTimeout',
      'grep',
      'repeatEach',
      'testIgnore',
      'tests',
      'selection',
      'sandboxCleanupTimeoutMs',
      'fullyParallel',
      'maxFailures',
    ]) {
      expect(writtenText).not.toMatch(new RegExp(`^\\s*${omitted}:`, 'mu'));
    }

    const report = await jsonReport(run);
    type ReportSuite = (typeof report.suites)[number];
    const results = (
      suite: ReportSuite,
    ): (typeof report.suites)[number]['specs'][number]['tests'][number]['results'] => [
      ...suite.specs.flatMap((spec) => spec.tests.flatMap((test) => test.results)),
      ...(suite.suites ?? []).flatMap(results),
    ];
    const attempts = report.suites.flatMap(results);
    expect(attempts).toHaveLength(4);
    for (const attempt of attempts) {
      const policy = attempt.attachments.find(({ name }) => name === 'blackbox-policy');
      expect(policy).toBeDefined();
      expect(Buffer.from(policy!.body!, 'base64').toString('utf8')).toContain(
        'baseline: ./baseline.yaml (matches)',
      );
    }
  },
  testTimeoutMs,
);

it.each(driftCases.filter(({ change }) => ['--retries', 'config projects'].includes(change)))(
  'fails a run whose tests all passed when $change drifts',
  async (input) => {
    const run = await playwright(input.args, { variant: input.variant });
    expectDrift(run, input);
    const { stats } = await jsonReport(run);
    expect(stats.expected).toBeGreaterThan(0);
    expect(stats.unexpected + stats.flaky).toBe(0);
  },
  testTimeoutMs,
);

// --list exercises the same onBegin capture and onEnd verdict without executing tests.
it.each(driftCases)(
  'prints the diff and fails when $change drifts',
  async (input) => {
    expectDrift(await playwright(['--list', ...input.args], { variant: input.variant }), input);
  },
  testTimeoutMs,
);

it(
  'passes --list on the baseline, so verification can run before any test executes',
  async () => {
    const run = await playwright(['--list']);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toContain('baseline: ./baseline.yaml (matches)');
  },
  testTimeoutMs,
);

it(
  'fails instead of skipping verification when the baseline is unusable',
  async () => {
    const run = await playwright(['--list'], { baseline: './missing-baseline.yaml' });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('baseline: ./missing-baseline.yaml is unusable: ENOENT');
    expect(run.stderr).toContain('Blackbox runner policy verification failed');
  },
  testTimeoutMs,
);
