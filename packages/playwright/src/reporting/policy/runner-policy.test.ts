import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, expect, it } from 'vitest';

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

const tests = (project: string) => [
  `${project} › policy.spec.ts › alpha`,
  `${project} › policy.spec.ts › beta`,
];
const unselected = (test: string) =>
  `policy.tests[${JSON.stringify(test)}]: baseline {"retries":1,"timeout":30000}, not in effective policy`;

interface DriftCase {
  readonly change: string;
  readonly args: readonly string[];
  readonly variant: string;
  readonly differences: readonly unknown[];
  /** Tests still selected, which must not be reported as removed. */
  readonly stillSelected: readonly string[];
}

const driftCases = [
  {
    change: 'config retries',
    variant: 'retries',
    args: [],
    stillSelected: [],
    differences: [
      'policy.projects.primary.retries: baseline 1, effective 2',
      'policy.tests["secondary › policy.spec.ts › beta"].retries: baseline 1, effective 2',
    ],
  },
  {
    change: '--retries',
    variant: 'baseline',
    args: ['--retries=3'],
    stillSelected: [],
    differences: [
      'policy.projects.secondary.retries: baseline 1, effective 3',
      'policy.tests["primary › policy.spec.ts › alpha"].retries: baseline 1, effective 3',
    ],
  },
  {
    change: 'config timeout',
    variant: 'timeout',
    args: [],
    stillSelected: [],
    differences: [
      'policy.projects.primary.timeout: baseline 30000, effective 45000',
      'policy.tests["primary › policy.spec.ts › beta"].timeout: baseline 30000, effective 45000',
    ],
  },
  {
    change: '--timeout',
    variant: 'baseline',
    args: ['--timeout=999'],
    stillSelected: [],
    differences: [
      'policy.tests["secondary › policy.spec.ts › alpha"].timeout: baseline 30000, effective 999',
    ],
  },
  {
    change: 'expect timeout',
    variant: 'expect-timeout',
    args: [],
    stillSelected: [],
    differences: ['policy.projects.primary.expectTimeout: baseline 5000, effective 9000'],
  },
  {
    change: 'config projects',
    variant: 'projects',
    args: [],
    stillSelected: tests('primary'),
    differences: [
      expect.stringMatching(
        /^policy\.projects\.secondary: baseline \{.*\}, not in effective policy$/u,
      ),
      ...tests('secondary').map(unselected),
    ],
  },
  {
    change: '--project',
    variant: 'baseline',
    args: ['--project=primary'],
    stillSelected: tests('primary'),
    differences: [
      'policy.selection.projects: baseline [], effective ["primary"]',
      ...tests('secondary').map(unselected),
    ],
  },
  {
    change: 'config grep',
    variant: 'grep',
    args: [],
    stillSelected: [tests('primary')[0], tests('secondary')[0]],
    differences: [
      'policy.run.grep: baseline "/.*/", effective "/alpha/u"',
      unselected(tests('primary')[1]),
    ],
  },
  {
    change: '--grep',
    variant: 'baseline',
    args: ['--grep=alpha'],
    stillSelected: [tests('primary')[0], tests('secondary')[0]],
    differences: [
      'policy.selection.grep: baseline null, effective "alpha"',
      unselected(tests('primary')[1]),
      unselected(tests('secondary')[1]),
    ],
  },
  {
    // F17: a CLI grep that still selects every test changes no test entry, so only the
    // recorded selection can surface it.
    change: '--grep that selects every test',
    variant: 'baseline',
    args: ['-g', '.'],
    stillSelected: [...tests('primary'), ...tests('secondary')],
    differences: ['policy.selection.grep: baseline null, effective "."'],
  },
  {
    change: '--grep-invert that excludes no test',
    variant: 'baseline',
    args: ['--grep-invert', 'no such test'],
    stillSelected: [...tests('primary'), ...tests('secondary')],
    differences: ['policy.selection.grepInvert: baseline null, effective "no such test"'],
  },
  {
    change: 'a file filter that selects every test',
    variant: 'baseline',
    args: ['policy.spec.ts'],
    stillSelected: [...tests('primary'), ...tests('secondary')],
    differences: ['policy.selection.testFilters: baseline [], effective ["policy.spec.ts"]'],
  },
  {
    // FullConfig.rootDir follows testDir, so testDir is recorded from the config directory.
    change: 'config testDir',
    variant: 'test-dir',
    args: [],
    stillSelected: [],
    differences: [
      'policy.projects.primary.testDir: baseline "tests", effective "."',
      'policy.projects.secondary.testDir: baseline "tests", effective "."',
    ],
  },
  {
    change: '--shard',
    variant: 'baseline',
    args: ['--shard=1/2'],
    stillSelected: tests('primary'),
    differences: ['policy.run.shard: baseline null, effective "1/2"'],
  },
] satisfies DriftCase[];

function expectDrift(run: Run, input: DriftCase): void {
  expect(run.code, run.stderr).toBe(1);
  expect(run.stderr).toContain('baseline: ./baseline.json differs');
  const printed = run.stderr.split('\n').map((line) => line.trim());
  expect(printed).toEqual(expect.arrayContaining([...input.differences]));
  for (const test of input.stillSelected) {
    expect(printed).not.toContain(unselected(test));
  }
  expect(run.stderr).toMatch(
    /Blackbox runner policy verification failed: \d+ difference\(s\) from baseline \.\/baseline\.json/u,
  );
}

it(
  'prints the effective policy, attaches it to each attempt, and passes on the baseline',
  async () => {
    const run = await playwright([]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toContain('Blackbox runner policy');
    expect(run.stderr).toContain('project "primary": retries=1 timeout=30000 expectTimeout=5000');
    expect(run.stderr).toContain('tests: 4 selected; retries 1×4; timeout 30000×4');
    expect(run.stderr).toContain(
      'selection: grep=null grepInvert=null projects=[] testFilters=[] lastFailed=false',
    );
    expect(run.stderr).toContain('baseline: ./baseline.json (matches)');
    expect(run.stderr).not.toContain('verification failed');
    // stdout stays the native reporters' own output.
    expect(run.stdout).not.toContain('Blackbox runner policy');

    const baseline = JSON.parse(await readFile(join(policyFixture, 'baseline.json'), 'utf8')) as {
      policy: unknown;
    };
    const written = JSON.parse(
      await readFile(join(run.directory, 'blackbox-policy.json'), 'utf8'),
    ) as { argv: string[]; policy: unknown };
    expect(written.policy).toEqual(baseline.policy);
    expect(written.argv).toContain('test');

    const report = await jsonReport(run);
    const attempts = report.suites.flatMap((suite) =>
      suite.specs.flatMap((spec) => spec.tests.flatMap((test) => test.results)),
    );
    expect(attempts).toHaveLength(4);
    for (const attempt of attempts) {
      const policy = attempt.attachments.find(({ name }) => name === 'blackbox-policy');
      expect(policy).toBeDefined();
      expect(Buffer.from(policy!.body!, 'base64').toString('utf8')).toContain(
        'baseline: ./baseline.json (matches)',
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
    expect(run.stderr).toContain('baseline: ./baseline.json (matches)');
  },
  testTimeoutMs,
);

it(
  'fails instead of skipping verification when the baseline is unusable',
  async () => {
    const run = await playwright(['--list'], { baseline: './missing-baseline.json' });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('baseline: ./missing-baseline.json is unusable: ENOENT');
    expect(run.stderr).toContain('Blackbox runner policy verification failed');
  },
  testTimeoutMs,
);
