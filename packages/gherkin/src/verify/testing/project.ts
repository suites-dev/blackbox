import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { testCatalog } from '../../compiler/testing/context.js';
import { runPlaywright, stubRuntimeModule, type PlaywrightRun } from '../../compiler/testing/playwright-cli.js';
import { compilerTestLibrary } from '../../library/testing/compiler-steps.js';
import { compileProject } from '../../project/compile.js';
import { loadGherkinProject, type GherkinProject } from '../../project/config.js';

// A disposable Gherkin project run under the real Playwright test CLI with the
// real defineGherkinConfig and Blackbox reporter. Only the step bodies and
// Sandbox acquisition are stubbed (compiler/testing/playwright-runtime.ts), so
// the run, policy and compile manifests are the ones a real project gets.

export const STUB_LIBRARY = compilerTestLibrary();

export const feature = (status: number): string => `@system:subscription-system @sandbox:bare @requirement:REQ-1
Feature: verified stub

  Background:
    Given the flow is sealed by the terminal response

  @requirement:REQ-2
  Scenario: the stub answers
    Then the response status is ${status}

  Rule: a second scenario

    Scenario: the stub answers again
      Then the response status is 200
`;

const PROJECT_FILE = {
  schemaVersion: 1,
  blackboxConfigFile: 'blackbox.config.yaml',
  features: ['features/**/*.feature'],
  outputDir: '.features-gen',
  runManifest: 'results/blackbox-run.json',
  policy: { baseline: 'blackbox.policy.json', outputFile: 'results/blackbox-policy.json' },
  sandboxes: { bare: {} },
};

const defineGherkinConfig = pathToFileURL(join(import.meta.dirname, '../../config/define.ts')).href;

const CONFIG = `import { defineGherkinConfig } from ${JSON.stringify(defineGherkinConfig)};

export default defineGherkinConfig({
  gherkinConfigFile: new URL('./blackbox.feature.yaml', import.meta.url),
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
`;

const roots: string[] = [];

export async function cleanupVerifyProjects(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export interface VerifyProject {
  readonly root: string;
  readonly project: GherkinProject;
  run(args?: readonly string[]): Promise<PlaywrightRun>;
}

function open(root: string): VerifyProject {
  return {
    root,
    project: loadGherkinProject(join(root, 'blackbox.feature.yaml')),
    run: (args = []) => runPlaywright(root, ['--config', 'playwright.config.mjs', ...args]),
  };
}

/** Writes, compiles and baselines a project whose first scenario's stub answers `status`. */
export async function verifyProject(status = 200): Promise<VerifyProject> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-verify-'));
  roots.push(root);
  await mkdir(join(root, 'features'));
  await writeFile(join(root, 'features/stub.feature'), feature(status));
  await writeFile(join(root, 'blackbox.feature.yaml'), stringify(PROJECT_FILE));
  await writeFile(join(root, 'playwright.config.mjs'), CONFIG);
  const opened = open(root);
  await compileProject({
    project: opened.project,
    catalog: testCatalog,
    library: STUB_LIBRARY,
    runtimeModule: stubRuntimeModule,
  });
  // The baseline is what a reviewer would accept: the effective policy of this config, as --list records it.
  const listed = await opened.run(['--list']);
  let recorded: { readonly policy: unknown };
  try {
    recorded = JSON.parse(await readFile(opened.project.policy.outputFile, 'utf8')) as { readonly policy: unknown };
  } catch (error) {
    throw new Error(`playwright --list recorded no runner policy:\n${listed.output}`, { cause: error });
  }
  await writeJson(opened.project.policy.baseline, { schemaVersion: 1, policy: recorded.policy });
  await rm(dirname(opened.project.policy.outputFile), { recursive: true, force: true });
  return opened;
}

/** A copy of a finished project, to change one file without touching the original. */
export async function copyOf(source: VerifyProject): Promise<VerifyProject> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-verify-copy-'));
  roots.push(root);
  await cp(source.root, root, { recursive: true });
  return open(root);
}

export async function readJson<T = Record<string, unknown>>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
