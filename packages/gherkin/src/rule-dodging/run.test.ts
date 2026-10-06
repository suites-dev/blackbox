import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import FeatureVerify from '../cli/commands/feature/verify.js';
import { useStubSystems } from '../library/testing/stub-lifecycle.js';
import type { StubMode } from '../library/testing/stub-system.js';
import { cleanupVerifyProjects, copyOf, libraryProject, type VerifyProject } from '../verify/testing/project.js';
import type { VerifyResult } from '../verify/verify.js';
import { useCommands } from './testing/commands.js';

// Rule-dodging suite, run gate (hard rules 4 and 5). A compiled, baselined
// project of the shared step library runs under the real Playwright CLI,
// defineGherkinConfig and Blackbox reporter against a loopback system, and is
// judged by the real `blackbox feature verify`. Each attempt changes only how
// the run is invoked or configured, as a change to the CI command line or the
// project's Playwright config would: a swapped reporter, changed retries or
// timeout, and a filter that leaves a scenario out. Each must end with a
// failing exit of the Playwright run, of verify, or both, with the reason.
// The control is the same project run as accepted. A rerun without the
// Blackbox reporter after an earlier run is covered by verify/verify.test.ts
// (the manifests are cleared before every run).

const runCommand = useCommands(beforeAll, afterAll, vi);
const system = useStubSystems(afterEach);
afterAll(cleanupVerifyProjects);

const FEATURE = `@system:subscription-system @sandbox:bare @requirement:REQ-1
Feature: service

  Scenario: the service is ready
    When the client sends GET "/health"
    Then the response status is 200

  @requirement:REQ-2
  Rule: a second scenario

    Scenario: the service is ready again
      When the client sends GET "/health"
      Then the response status is 200
`;

const FIRST = 'features/stub.feature:4';
const SECOND = 'features/stub.feature:11';

let accepted: VerifyProject;

beforeAll(async () => {
  accepted = await libraryProject(FEATURE);
}, 120_000);

interface Gate {
  readonly run: { readonly code: number; readonly output: string };
  readonly verify: { readonly exit: number; readonly verdicts: readonly (readonly [string, string])[]; readonly problems: readonly string[] };
}

/** Runs a copy of the accepted project against a loopback system, then `blackbox feature verify --json`. */
async function gate(change: (project: VerifyProject) => Promise<readonly string[]>, mode: StubMode = 'correct'): Promise<Gate> {
  const project = await copyOf(accepted);
  const args = await change(project);
  const sut = await system(mode);
  const run = await project.run(args, { BLACKBOX_LOOPBACK_URL: sut.url });
  const verify = await runCommand(FeatureVerify, ['--config', project.project.configFile, '--json']);
  const result = JSON.parse(verify.stdout) as VerifyResult;
  return {
    run,
    verify: {
      exit: verify.exit,
      verdicts: result.scenarios.map((scenario) => [scenario.id, scenario.verdict] as const),
      problems: result.problems,
    },
  };
}

const commandLine = (...args: string[]) => () => Promise.resolve(args);

/** Changes one setting of the project's Playwright config, as a code change would. */
const configSetting = (from: string, to: string) => async (project: VerifyProject) => {
  const config = join(project.root, 'playwright.config.mjs');
  const text = await readFile(config, 'utf8');
  expect(text).toContain(from);
  await writeFile(config, text.replace(from, to));
  return [];
};

const FAILED_RUN = 'the run status is "failed", not "passed"';
const BOTH_SUPPORTED = [
  [FIRST, 'supported'],
  [SECOND, 'supported'],
];

/** The drift problem verify reports, with each expected difference. */
function expectDrift(result: Gate, differences: readonly string[]): void {
  expect(result.run.code, result.run.output).toBe(1);
  expect(result.run.output).toContain(`Blackbox runner policy verification failed: ${differences.length} difference(s) from baseline`);
  expect(result.verify.exit).toBe(1);
  const drift = result.verify.problems.find((problem) => problem.startsWith('the runner policy differs from the baseline blackbox.policy.yaml'));
  expect(drift, result.verify.problems.join('\n')).toBeDefined();
  expect(drift!.split('\n').slice(1).map((line) => line.trim())).toEqual(differences);
}

describe('control', { timeout: 120_000 }, () => {
  it('the accepted project passes the run and verify', async () => {
    const result = await gate(commandLine());
    expect(result.run.code, result.run.output).toBe(0);
    expect(result.verify).toEqual({ exit: 0, verdicts: BOTH_SUPPORTED, problems: [] });
  });
});

describe('a reporter swapped on the command line', { timeout: 120_000 }, () => {
  const MISSING = (project: VerifyProject) => [
    `no run manifest at ${project.project.runManifest}: the Blackbox reporter did not write one, so the run had no strict verdicts (was the reporter replaced on the command line?)`,
    `no runner-policy manifest at ${project.project.policy.outputFile}: the Blackbox reporter did not record the effective runner policy`,
  ];

  it.each([
    ['a built-in reporter', '--reporter=list'],
    ['the Blackbox reporter without strict verdicts or the baseline', '--reporter=list,@suites/blackbox-playwright/reporter'],
  ])('passes Playwright with %s, and verify exits 1 because no manifest was written', async (_name, reporter) => {
    let swapped: VerifyProject | undefined;
    const result = await gate((project) => {
      swapped = project;
      return Promise.resolve([reporter]);
    });
    expect(result.run.code, result.run.output).toBe(0);
    expect(result.verify).toEqual({ exit: 1, verdicts: [], problems: MISSING(swapped!) });
  });

  // Stated limit: code the project runs inside Playwright can write any file,
  // so a project reporter can forge both manifests. verify cannot tell, and
  // the run passes. The defence is protecting how runs are configured: the
  // separation check makes Playwright configs, project reporters, global setup
  // and the Gherkin CI workflow protected spec
  // (https://github.com/suites-dev/blackbox/pull/133), with code-owner review.
  it('stated limit: a project reporter that forges both manifests passes the run and verify, against a failing system', async () => {
    const result = await gate(async (project) => {
      await mkdir(join(project.root, 'reporters'));
      await writeFile(join(project.root, 'reporters/forge.mjs'), FORGE);
      return ['--reporter=./reporters/forge.mjs'];
    }, 'not-ready');
    expect(result.run.code, result.run.output).toBe(0);
    expect(result.verify).toEqual({ exit: 0, verdicts: BOTH_SUPPORTED, problems: [] });
  });
});

// The forged reporter reads and writes the YAML runner-policy files with this package's yaml.
const YAML_MODULE = pathToFileURL(createRequire(import.meta.url).resolve('yaml')).href;

const FORGE = `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parse, stringify } from ${JSON.stringify(YAML_MODULE)};

export default class Forge {
  onBegin(config, suite) {
    this.root = dirname(config.configFile);
    this.suite = suite;
  }

  onEnd() {
    const baseline = parse(readFileSync(join(this.root, 'blackbox.policy.yaml'), 'utf8'));
    mkdirSync(join(this.root, 'results'), { recursive: true });
    writeFileSync(join(this.root, 'results/blackbox-policy.yaml'), stringify({ ...baseline, argv: [] }));
    const scenarios = this.suite.allTests().map((test) => ({
      id: test.id,
      titlePath: test.titlePath().filter(Boolean),
      location: { file: '', line: 0, column: 0 },
      requirements: test.annotations.filter((annotation) => annotation.type === 'requirement').map((annotation) => annotation.description),
      expectedStatus: 'passed',
      outcome: 'expected',
      attempts: [],
      verdict: 'supported',
      reasons: [],
    }));
    writeFileSync(join(this.root, 'results/blackbox-run.json'), JSON.stringify({ schemaVersion: 0, verdicts: 'strict', status: 'passed', scenarios }));
    return { status: 'passed' };
  }
}
`;

describe('changed retries or timeout', { timeout: 120_000 }, () => {
  it.each([
    // The project's retries or timeout move off their default; its tests follow the project, so none is listed.
    ['--retries on the command line', commandLine('--retries=2'), 'retries: not in baseline, effective 2'],
    ['--timeout on the command line', commandLine('--timeout=5000'), 'timeout: not in baseline, effective 5000'],
    ['retries in the Playwright config', configSetting('retries: 0,', 'retries: 1,'), 'retries: not in baseline, effective 1'],
  ])('%s fails the run and verify as runner-policy drift', async (_name, change, difference) => {
    const result = await gate(change);
    expectDrift(result, [`policy.projects[""].${difference}`]);
    expect(result.verify.verdicts).toEqual(BOTH_SUPPORTED);
    expect(result.verify.problems[0]).toBe(FAILED_RUN);
  });
});

describe('a filtered-out scenario', { timeout: 120_000 }, () => {
  it.each([
    ['--grep', commandLine('--grep', 'again'), ['policy.selection: not in baseline, effective {"grep":"again"}'], [[FIRST, 'not-run'], [SECOND, 'supported']]],
    [
      'a file:line filter',
      commandLine('.features-gen/features/stub.feature.spec.mjs:10'),
      ['policy.selection: not in baseline, effective {"testFilters":[".features-gen/features/stub.feature.spec.mjs:10"]}'],
      [[FIRST, 'supported'], [SECOND, 'not-run']],
    ],
    [
      '--shard',
      commandLine('--shard=2/2'),
      ['policy.shard: not in baseline, effective "2/2"'],
      [[FIRST, 'not-run'], [SECOND, 'not-run']],
    ],
  ])('by %s fails the run and verify, which reports the scenario as not run', async (_name, change, differences, verdicts) => {
    const result = await gate(change);
    expectDrift(result, differences);
    expect(result.verify.verdicts).toEqual(verdicts);
    expect(result.verify.problems[0]).toBe(FAILED_RUN);
  });
});
