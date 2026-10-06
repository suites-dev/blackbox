import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stubRuntimeModule } from '../compiler/testing/playwright-cli.js';
import { cleanupVerifyProjects, STUB_LIBRARY, stubProject, writeProject } from '../verify/testing/project.js';
import { defineGherkinConfig } from './define.js';

// Requirement (benchmark finding F4): a barrier's stated deadline must be the
// effective one. The test timeout bounds the whole scenario, so when a
// compiled scenario's barrier deadlines, Background included, reach a
// project's test timeout, defineGherkinConfig throws before any test or
// Sandbox starts, naming the scenario, its deadlines and the timeout.

let root = '';
let gherkinConfigFile = '';

const GR2 = {
  feature: 'features/runtime-guardrails.feature',
  line: 13,
  titlePath: ['Feature: GR2', 'Scenario: a barrier deadline longer than the test timeout'],
  barrierDeadlines: [{ line: 18, column: 5, seconds: 300 }],
};
const BACKGROUND = {
  feature: 'features/orders.feature',
  line: 9,
  titlePath: ['Feature: orders', 'Scenario: the order arrives'],
  barrierDeadlines: [
    { line: 6, column: 5, seconds: 20 },
    { line: 12, column: 5, seconds: 15 },
  ],
};
const NO_BARRIER = { feature: 'features/health.feature', line: 4, titlePath: ['Feature: health', 'Scenario: ready'], barrierDeadlines: [] };

const GR2_LINE =
  'features/runtime-guardrails.feature:13 Scenario: a barrier deadline longer than the test timeout: barrier deadlines of 300 s (300 s at line 18) do not fit the';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-deadlines-'));
  gherkinConfigFile = join(root, 'blackbox.feature.yaml');
  await writeFile(
    gherkinConfigFile,
    JSON.stringify({
      schemaVersion: 1,
      blackboxConfigFile: 'blackbox.config.yaml',
      features: ['features/**/*.feature'],
      outputDir: '.features-gen',
      runManifest: 'results/blackbox-run.json',
      policy: { baseline: 'blackbox.policy.yaml', outputFile: 'results/blackbox-policy.yaml' },
      sandboxes: { default: {} },
    }),
  );
  await mkdir(join(root, '.features-gen'));
  await writeFile(
    join(root, '.features-gen/compile-manifest.json'),
    JSON.stringify({ schemaVersion: 1, scenarios: [GR2, BACKGROUND, NO_BARRIER] }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await cleanupVerifyProjects();
});

describe('barrier deadlines and the test timeout (benchmark F4)', () => {
  it('refuses a scenario whose deadline reaches the timeout, as GR2 did under 90 s', () => {
    expect(() => defineGherkinConfig({ gherkinConfigFile, timeout: 90_000 })).toThrow(
      `defineGherkinConfig: the test timeout would cut a barrier deadline the feature states:\n  ${GR2_LINE} 90000 ms test timeout\n`,
    );
    // Equal is refused too: the scenario's other steps and its Sandbox need time as well.
    expect(() => defineGherkinConfig({ gherkinConfigFile, timeout: 300_000 })).toThrow(`${GR2_LINE} 300000 ms test timeout`);
    expect(defineGherkinConfig({ gherkinConfigFile, timeout: 301_000 }).timeout).toBe(301_000);
  });

  it('adds Background barriers to the scenario, and compares Playwright\'s default timeout when none is set', () => {
    expect(() => defineGherkinConfig({ gherkinConfigFile })).toThrow(
      'features/orders.feature:9 Scenario: the order arrives: barrier deadlines of 35 s (20 s at line 6, 15 s at line 12) do not fit the 30000 ms test timeout',
    );
  });

  it('checks every project at its own timeout, and none under timeout 0', () => {
    const refused = () =>
      defineGherkinConfig({
        gherkinConfigFile,
        timeout: 400_000,
        projects: [{ name: 'fast', timeout: 60_000 }, { name: 'slow' }],
      });
    expect(refused).toThrow(`${GR2_LINE} 60000 ms test timeout of project "fast"`);
    expect(refused).not.toThrow('project "slow"');
    expect(defineGherkinConfig({ gherkinConfigFile, timeout: 0 }).timeout).toBe(0);
  });
});

describe('the refusal under the real Playwright CLI', { timeout: 60_000 }, () => {
  const feature = (seconds: number) => `@system:subscription-system @sandbox:bare
Feature: deadlines

  Background:
    Given the flow is sealed within 20 seconds

  Scenario: the order arrives
    When the client sends GET "/orders"
    Then the flow is sealed within ${seconds} seconds
    And the response status is 200
`;

  it('fails the run at config load, before any test, when the deadlines outlast the 30 s default', async () => {
    const project = await writeProject(feature(15), STUB_LIBRARY, stubRuntimeModule);
    const run = await project.run();
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain(
      'features/stub.feature:7 Scenario: the order arrives: barrier deadlines of 35 s (20 s at line 5, 15 s at line 9) do not fit the 30000 ms test timeout',
    );
    expect(run.output).not.toContain('Running 1 test');
  });

  it('lists the test, against its accepted baseline, when the deadlines fit', async () => {
    const project = await stubProject(feature(5));
    const listed = await project.run(['--list']);
    expect(listed.code, listed.output).toBe(0);
    expect(listed.output).toContain('Scenario: the order arrives');
  });
});
