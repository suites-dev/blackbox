import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { StepDefinition } from '../runtime/step-types.js';
import { cleanupVerifyProjects, libraryProject, type VerifyProject } from '../verify/testing/project.js';
import { verifyRun } from '../verify/verify.js';
import { library } from './index.js';
import { barrierSteps } from './steps/barrier.js';
import { responseSteps } from './steps/response.js';
import { setupSteps } from './steps/setup.js';
import { stateSteps } from './steps/state.js';
import { stimulusSteps } from './steps/stimulus.js';
import { useStubSystems } from './testing/stub-lifecycle.js';

// Requirement (hard rule 3, rule-dodging finding F1): no code loaded into a
// run can replace a reviewed step body. Every step definition is deep-frozen
// where it is declared, its body included, so the config-import probe (a
// project module imported by the Playwright config that assigns a new body to
// `the response status is {int}`) is refused when the config loads, the run
// fails and verify fails, instead of a failing claim passing as supported.

const system = useStubSystems(afterEach);
afterAll(cleanupVerifyProjects);

const STEP_MODULES = { setupSteps, stimulusSteps, barrierSteps, responseSteps, stateSteps };

describe('the shared step library is frozen where it is declared', () => {
  it.each(Object.entries(STEP_MODULES))('%s: the list, every definition, its fixtures and its body', (_name, steps) => {
    expect(Object.isFrozen(steps)).toBe(true);
    for (const definition of steps) {
      expect(Object.isFrozen(definition), definition.expression).toBe(true);
      expect(Object.isFrozen(definition.fixtures), definition.expression).toBe(true);
      expect(Object.isFrozen(definition.run), definition.expression).toBe(true);
    }
  });

  it('refuses a replaced, redefined or removed step, so the reviewed body is the one that resolves', () => {
    const [status] = responseSteps;
    const reviewed = status.run;
    const replacement = () => Promise.resolve();
    expect(() => {
      (status as { run: StepDefinition['run'] }).run = replacement;
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(status, 'run', { value: replacement })).toThrow(TypeError);
    expect(() => (responseSteps as StepDefinition[]).splice(0, 1)).toThrow(TypeError);
    expect(() => (status.fixtures as string[]).push('page')).toThrow(TypeError);
    expect(status.run).toBe(reviewed);
    expect(library.resolve('the response status is 200')).toMatchObject({ status: 'resolved', definition: status });
  });
});

const FEATURE = `@system:subscription-system @sandbox:bare @requirement:REQ-1
Feature: service

  Scenario: the service is ready
    When the client sends GET "/health"
    Then the response status is 200
`;

// The probe's project module: it reaches the library by file path, which the
// package exports do not block and \`blackbox feature check\` does not match.
const HOOKS = `import { responseSteps } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'steps/response.ts')).href)};

responseSteps[0].run = () => Promise.resolve();
`;

const verify = (project: VerifyProject) => verifyRun({ project: project.project, library });

describe('the config-import probe (rule-dodging F1) under the real Playwright CLI', { timeout: 120_000 }, () => {
  it('control: the shared library fails the status claim against a system that is not ready', async () => {
    const sut = await system('not-ready');
    const project = await libraryProject(FEATURE);
    const run = await project.run([], { BLACKBOX_LOOPBACK_URL: sut.url });
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain('status of GET /health');
    const result = await verify(project);
    expect(result.ok).toBe(false);
    expect(result.scenarios.map((scenario) => [scenario.verdict, scenario.reasons])).toEqual([['not-supported', ['failed']]]);
  });

  it('refuses the replaced body when the config loads, and verify fails', async () => {
    const sut = await system('not-ready');
    const project = await libraryProject(FEATURE);
    await mkdir(join(project.root, 'support'));
    await writeFile(join(project.root, 'support/hooks.mjs'), HOOKS);
    const config = join(project.root, 'playwright.config.mjs');
    await writeFile(config, `import './support/hooks.mjs';\n${await readFile(config, 'utf8')}`);
    const run = await project.run([], { BLACKBOX_LOOPBACK_URL: sut.url });
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain("Cannot assign to read only property 'run'");
    expect(sut.received).toEqual([]);
    const result = await verify(project);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      `no run manifest at ${project.project.runManifest}: the Blackbox reporter did not write one, so the run had no strict verdicts (was the reporter replaced on the command line?)`,
      `no runner-policy manifest at ${project.project.policy.outputFile}: the Blackbox reporter did not record the effective runner policy`,
    ]);
  });
});
