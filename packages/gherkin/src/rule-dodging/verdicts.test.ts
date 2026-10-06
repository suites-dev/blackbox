import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import FeatureVerify from '../cli/commands/feature/verify.js';
import { useStubSystems } from '../library/testing/stub-lifecycle.js';
import { cleanupVerifyProjects, copyOf, libraryProject, recordBaseline, type VerifyProject } from '../verify/testing/project.js';
import type { VerifyResult } from '../verify/verify.js';
import { useCommands } from './testing/commands.js';
import { startFlakySystem, type FlakySystem } from './testing/flaky-system.js';

// Rule-dodging suite, verdicts (hard rule 4): only a supported result passes.
// Playwright counts a test that passes on a retry and a test that fails while
// marked as expected to fail as ok; under defineGherkinConfig the run and
// `blackbox feature verify` must both end red for them, naming the reason.
// The project runs the shared step library under the real Playwright CLI and
// Blackbox reporter against a loopback system. Each case has a control that
// passes, so the failure is the result's, not the setup's.

const runCommand = useCommands(beforeAll, afterAll, vi);
const system = useStubSystems(afterEach);
afterAll(cleanupVerifyProjects);

const flaky: FlakySystem[] = [];
afterEach(async () => {
  await Promise.all(flaky.splice(0).map((sut) => sut.close()));
});

const FEATURE = `@system:subscription-system @sandbox:bare @requirement:REQ-1
Feature: service

  Scenario: the service is ready
    When the client sends GET "/health"
    Then the response status is 200
`;

const SCENARIO = 'features/stub.feature:4';
const VERDICT = 'Scenario: the service is ready';
const FAILED_RUN = 'the run status is "failed", not "passed"';

async function verify(project: VerifyProject) {
  const run = await runCommand(FeatureVerify, ['--config', project.project.configFile, '--json']);
  const result = JSON.parse(run.stdout) as VerifyResult;
  return {
    exit: run.exit,
    verdicts: result.scenarios.map((scenario) => [scenario.id, scenario.verdict, scenario.reasons] as const),
    problems: result.problems,
  };
}

describe('a flaky result', { timeout: 120_000 }, () => {
  let retrying: VerifyProject;

  // A reviewed baseline that accepts one retry, so the retry itself is not drift.
  beforeAll(async () => {
    retrying = await libraryProject(FEATURE);
    const config = join(retrying.root, 'playwright.config.mjs');
    await writeFile(config, (await readFile(config, 'utf8')).replace('retries: 0,', 'retries: 1,'));
    await recordBaseline(retrying);
  }, 120_000);

  it('control: a steady system passes the run and verify under the accepted retry', async () => {
    const project = await copyOf(retrying);
    const run = await project.run([], { BLACKBOX_LOOPBACK_URL: (await system('correct')).url });
    expect(run.code, run.output).toBe(0);
    expect(await verify(project)).toEqual({ exit: 0, verdicts: [[SCENARIO, 'supported', []]], problems: [] });
  });

  it('fails the run and verify when the scenario passes only on its retry', async () => {
    const project = await copyOf(retrying);
    const sut = await startFlakySystem();
    flaky.push(sut);
    const run = await project.run([], { BLACKBOX_LOOPBACK_URL: sut.url });
    expect(sut.requests()).toBe(2);
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain('1 flaky');
    expect(run.output).toMatch(new RegExp(`^not supported \\(flaky\\) \\[REQ-1\\] .* › ${VERDICT}$`, 'mu'));
    expect(await verify(project)).toEqual({
      exit: 1,
      verdicts: [[SCENARIO, 'not-supported', ['flaky']]],
      problems: [FAILED_RUN],
    });
  });
});

describe('an expected-to-fail result', { timeout: 120_000 }, () => {
  let accepted: VerifyProject;

  beforeAll(async () => {
    accepted = await libraryProject(FEATURE);
  }, 120_000);

  // As a patched runtime could: every test is marked as expected to fail, and the claim fails.
  const EXPECT_FAILURE = { BLACKBOX_LOOPBACK_EXPECT_FAILURE: '1' };

  it('control: Playwright alone counts the inverted failing claim as passed', async () => {
    const project = await copyOf(accepted);
    const sut = await system('not-ready');
    const run = await project.run(['--reporter=list'], { BLACKBOX_LOOPBACK_URL: sut.url, ...EXPECT_FAILURE });
    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain('1 passed');
  });

  it('fails the run and verify under the Blackbox reporter', async () => {
    const project = await copyOf(accepted);
    const sut = await system('not-ready');
    const run = await project.run([], { BLACKBOX_LOOPBACK_URL: sut.url, ...EXPECT_FAILURE });
    expect(run.code, run.output).toBe(1);
    expect(sut.received.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /health']);
    expect(run.output).toMatch(new RegExp(`^not supported \\(expected-to-fail\\) \\[REQ-1\\] .* › ${VERDICT}$`, 'mu'));
    expect(await verify(project)).toEqual({
      exit: 1,
      verdicts: [[SCENARIO, 'not-supported', ['expected-to-fail']]],
      problems: [FAILED_RUN],
    });
  });
});
