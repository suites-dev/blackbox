import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanupRepositories, repository } from '../check/testing/repository.js';
import FeatureCheck from '../cli/commands/feature/check.js';
import { compileFeatures } from '../compiler/compile.js';
import { testContext } from '../compiler/testing/context.js';
import { runPlaywright, stubRuntimeModule } from '../compiler/testing/playwright-cli.js';
import { useCommands } from './testing/commands.js';

// Rule-dodging suite, step definitions (hard rule 3): steps come only from the
// shared library. `blackbox feature check` must exit 1 for a project step file
// and for an import that registers or runs steps outside the library. Its
// match is static, so it does not see a file-path or computed import, a step
// file outside the project directory or a symlinked one. None of those can
// change a step: the library is closed, and its definitions are frozen where
// they are declared (library/frozen.test.ts), so a project module that replaces
// a step body fails the Playwright run as soon as its config loads (below).
// With blackbox feature verify, the same probe also fails verify
// (library/frozen.test.ts on the verification PR).
// A change that mixes spec and code, or code and the policy baseline, is hard
// rule 2: covered by check-change (check/change.test.ts) and by the repository
// separation check's fixtures (scripts/check-spec-separation.test.mjs,
// https://github.com/suites-dev/blackbox/pull/133), not repeated here.

const runCommand = useCommands(beforeAll, afterAll, vi);

afterEach(cleanupRepositories);

const check = (root: string) => runCommand(FeatureCheck, ['--config', join(root, 'app/blackbox.gherkin.json')]);

const PASSED = 'check: passed; no project step files or step-registration imports, no patched or forked step library, .features-gen/ not tracked';

describe('a project step file or stray step-registration import fails check', () => {
  it('control: a project with features and application code only passes', async () => {
    const repo = await repository();
    await repo.commit('base');
    expect(await check(repo.root)).toMatchObject({ exit: 0, stdout: `${PASSED}\n` });
  });

  it('exits 1 for each project step file', async () => {
    const repo = await repository({
      'app/features/support/intake.steps.ts': "export const steps = ['a subscription exists'];\n",
      'app/tests/subscription.steps.mjs': 'export {};\n',
      'app/step_definitions/login.js': 'export {};\n',
    });
    await repo.commit('base');
    const run = await check(repo.root);
    expect(run.exit).toBe(1);
    const stepFile = (file: string) => `error: ${file}: a project step file; steps come only from the shared Blackbox step library`;
    expect(run.stdout.trim().split('\n')).toEqual([
      stepFile('features/support/intake.steps.ts'),
      stepFile('step_definitions/login.js'),
      stepFile('tests/subscription.steps.mjs'),
      'check: failed; 3 problem(s)',
    ]);
  });

  it('exits 1 for each import that registers or runs steps outside the library, in every import form', async () => {
    const repo = await repository({
      'app/playwright.config.ts': "import { defineBddConfig } from 'playwright-bdd';\nexport default defineBddConfig({});\n",
      'app/support/register.ts': [
        "import { Given } from '@cucumber/cucumber/lib/index.js';",
        "export * from 'playwright-bdd/decorators';",
        "const { runStep } = require('@suites/blackbox-gherkin');",
        "const registry = await import('@suites/blackbox-gherkin/dist/runtime/registry.js');",
        'Given(registry, runStep);',
      ].join('\n'),
    });
    await repo.commit('base');
    const run = await check(repo.root);
    expect(run.exit).toBe(1);
    expect(run.stdout.trim().split('\n')).toEqual([
      'error: playwright.config.ts: imports "playwright-bdd"; playwright-bdd defines its own steps',
      'error: support/register.ts: imports "@cucumber/cucumber/lib/index.js"; Cucumber step definitions are not the shared library',
      'error: support/register.ts: imports "playwright-bdd/decorators"; playwright-bdd defines its own steps',
      expect.stringMatching(/^error: support\/register\.ts: imports "@suites\/blackbox-gherkin"; only generated tests import the Gherkin runtime/u),
      expect.stringMatching(/^error: support\/register\.ts: imports "@suites\/blackbox-gherkin\/dist\/runtime\/registry\.js"; only generated tests import the Gherkin runtime/u),
      'check: failed; 5 problem(s)',
    ]);
  });
});

// The config-import probe: a project module, reached from the Playwright
// config by a file path that check does not match, assigns a new body to the
// library's `the response status is {int}`.
const HOOKS = `import { responseSteps } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../library/steps/response.ts')).href)};

responseSteps[0].run = () => Promise.resolve();
`;

const FEATURE = `@system:subscription-system @sandbox:bare
Feature: service

  Scenario: the service answers
    Given the flow is sealed by the terminal response
    Then the response status is 200
`;

const CONFIG = "export default { testDir: '.features-gen', workers: 1, retries: 0, reporter: [['list']] };\n";

describe('a project module that replaces a library step body', { timeout: 120_000 }, () => {
  async function probeProject(hooks: boolean) {
    const repo = await repository({
      'app/.gitignore': '.features-gen/\n',
      'app/features/intake.feature': FEATURE,
      'app/support/hooks.mjs': HOOKS,
      'app/playwright.config.mjs': `${hooks ? "import './support/hooks.mjs';\n" : ''}${CONFIG}`,
    });
    await repo.commit('base');
    const app = join(repo.root, 'app');
    await compileFeatures({
      rootDir: app,
      outputDir: join(app, '.features-gen'),
      features: ['features/intake.feature'],
      context: testContext(),
      runtimeModule: stubRuntimeModule,
    });
    return { root: repo.root, run: () => runPlaywright(app, ['--config', 'playwright.config.mjs']) };
  }

  it('control: without the probe the compiled scenario passes the run', async () => {
    const project = await probeProject(false);
    const run = await project.run();
    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain('1 passed');
  });

  it('passes check, but fails the Playwright run when its config loads, before any test runs', async () => {
    const project = await probeProject(true);
    expect(await check(project.root)).toMatchObject({ exit: 0, stdout: `${PASSED}\n` });
    const run = await project.run();
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain("Cannot assign to read only property 'run'");
    expect(run.output).not.toMatch(/\d+ passed/u);
  });
});
