import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { testCatalog } from '../../compiler/testing/context.js';
import {
  libraryRuntimeModule,
  runPlaywright,
  stubRuntimeModule,
  type PlaywrightRun,
} from '../../compiler/testing/playwright-cli.js';
import { library } from '../../library/index.js';
import { compilerTestLibrary } from '../../library/testing/compiler-steps.js';
import { compileProject } from '../../project/compile.js';
import { loadGherkinProject, type GherkinProject } from '../../project/config.js';
import type { StepLibrary } from '../../runtime/library.js';

// A disposable Gherkin project run under the real Playwright test CLI with the
// real defineGherkinConfig and Blackbox reporter. Only the step bodies and
// Sandbox acquisition are stubbed (compiler/testing/playwright-runtime.ts), so
// the run, policy and compile manifests are the ones a real project gets. A
// library project runs the shared step library's own bodies against a
// loopback system instead (compiler/testing/library-runtime.ts).

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
  run(args?: readonly string[], env?: Readonly<Record<string, string>>): Promise<PlaywrightRun>;
}

function open(root: string): VerifyProject {
  return {
    root,
    project: loadGherkinProject(join(root, 'blackbox.feature.yaml')),
    run: (args = [], env = {}) => runPlaywright(root, ['--config', 'playwright.config.mjs', ...args], env),
  };
}

/** Writes and compiles a project with one feature, compiled against `stepLibrary`, without a baseline. */
export async function writeProject(text: string, stepLibrary: StepLibrary, runtimeModule: string): Promise<VerifyProject> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-verify-'));
  roots.push(root);
  await mkdir(join(root, 'features'));
  await writeFile(join(root, 'features/stub.feature'), text);
  await writeFile(join(root, 'blackbox.feature.yaml'), stringify(PROJECT_FILE));
  await writeFile(join(root, 'playwright.config.mjs'), CONFIG);
  const opened = open(root);
  await compileProject({ project: opened.project, catalog: testCatalog, library: stepLibrary, runtimeModule });
  return opened;
}

/** Writes, compiles and baselines a project with one feature, compiled against `stepLibrary`. */
async function createProject(text: string, stepLibrary: StepLibrary, runtimeModule: string): Promise<VerifyProject> {
  const opened = await writeProject(text, stepLibrary, runtimeModule);
  // The baseline is what a reviewer would accept: the effective policy of this config, as --list records it.
  const listed = await opened.run(['--list']);
  let recorded: { readonly schemaVersion: unknown; readonly policy: unknown };
  try {
    recorded = JSON.parse(await readFile(opened.project.policy.outputFile, 'utf8')) as {
      readonly schemaVersion: unknown;
      readonly policy: unknown;
    };
  } catch (error) {
    throw new Error(`playwright --list recorded no runner policy:\n${listed.output}`, { cause: error });
  }
  await writeJson(opened.project.policy.baseline, { schemaVersion: recorded.schemaVersion, policy: recorded.policy });
  await rm(dirname(opened.project.policy.outputFile), { recursive: true, force: true });
  return opened;
}

/** A baselined project of `text` compiled against the stub library. */
export function stubProject(text: string): Promise<VerifyProject> {
  return createProject(text, STUB_LIBRARY, stubRuntimeModule);
}

/** A project whose first scenario's stub answers `status`. */
export function verifyProject(status = 200): Promise<VerifyProject> {
  return stubProject(feature(status));
}

/**
 * A project of `text` compiled against the shared step library. Its steps
 * address the loopback system at BLACKBOX_LOOPBACK_URL, which each run passes.
 */
export function libraryProject(text: string): Promise<VerifyProject> {
  return createProject(text, library, libraryRuntimeModule);
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
