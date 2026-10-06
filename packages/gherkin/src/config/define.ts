import { createRequire } from 'node:module';
import { extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@suites/blackbox-playwright/config';

import { loadGherkinProject, type GherkinProject } from '../project/config.js';
import { MANIFESTS_METADATA_KEY } from './clear-manifests.js';
import { compiledScenarios, projectTimeouts, unfitDeadlines } from './deadlines.js';

type BlackboxPlaywrightConfig = Parameters<typeof defineConfig>[0];
type ReporterEntry = Exclude<NonNullable<BlackboxPlaywrightConfig['reporter']>, string>[number];

/** Settings defineGherkinConfig owns. A caller that sets one is refused, never silently overridden. */
const OWNED = ['blackboxConfigFile', 'testDir', 'testMatch', 'testIgnore', 'failOnFlakyTests', 'forbidOnly'] as const;
const PROJECT_OWNED = ['testDir', 'testMatch', 'testIgnore'] as const;

export type GherkinPlaywrightConfig = Omit<BlackboxPlaywrightConfig, (typeof OWNED)[number]> & {
  /**
   * The project's blackbox.feature.yaml, as an absolute path or file URL, for
   * example `new URL('./blackbox.feature.yaml', import.meta.url)`.
   */
  readonly gherkinConfigFile: string | URL;
};

/** Generated tests, as the compiler names them next to their features. */
export const GENERATED_TESTS = '**/*.feature.spec.mjs';

// The reporter this package was built against, by path, so the generated tests,
// the reporter and the config share one @suites/blackbox-playwright.
const REPORTER_SPECIFIER = '@suites/blackbox-playwright/reporter';
const reporterFile = createRequire(import.meta.url).resolve(REPORTER_SPECIFIER);

// The global setup next to this module: .js when built, .ts under the blackbox-source condition.
const clearManifestsFile = fileURLToPath(
  new URL(`./clear-manifests${extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);

function configFilePath(file: string | URL): string {
  const path = file instanceof URL ? fileURLToPath(file) : file;
  if (!isAbsolute(path)) {
    throw new Error(
      `gherkinConfigFile must be absolute, for example new URL('./blackbox.feature.yaml', import.meta.url); got ${path}`,
    );
  }
  return path;
}

function refuseOwned(config: object, owned: readonly string[], where: string): void {
  const set = owned.filter((key) => Object.hasOwn(config, key));
  if (set.length > 0) {
    throw new Error(
      `defineGherkinConfig sets ${set.join(', ')}${where}; remove ${set.length === 1 ? 'it' : 'them'} from the config`,
    );
  }
}

function reportersOf(reporter: BlackboxPlaywrightConfig['reporter']): ReporterEntry[] {
  if (reporter === undefined) {
    return [['list']];
  }
  const list: ReporterEntry[] = typeof reporter === 'string' ? [[reporter]] : [...reporter];
  for (const [specifier] of list) {
    if (specifier === REPORTER_SPECIFIER || specifier === reporterFile) {
      throw new Error('defineGherkinConfig adds the Blackbox reporter with strict verdicts; remove it from reporter');
    }
  }
  return list;
}

function globalSetupsOf(globalSetup: BlackboxPlaywrightConfig['globalSetup']): readonly string[] {
  if (globalSetup === undefined) {
    return [];
  }
  return typeof globalSetup === 'string' ? [globalSetup] : globalSetup;
}

/** A stated barrier deadline must be the effective one, so each scenario's deadlines must fit its test timeout. */
function refuseUnfitDeadlines(project: GherkinProject, config: Pick<BlackboxPlaywrightConfig, 'timeout' | 'projects'>): void {
  const unfit = unfitDeadlines(compiledScenarios(project.outputDir), projectTimeouts(config));
  if (unfit.length > 0) {
    throw new Error(
      [
        'defineGherkinConfig: the test timeout would cut a barrier deadline the feature states:',
        ...unfit.map((line) => `  ${line}`),
        'Raise timeout above the deadlines (and accept the new runner-policy baseline), or shorten them in the feature.',
      ].join('\n'),
    );
  }
}

function strictReporter(project: GherkinProject): ReporterEntry {
  return [
    reporterFile,
    {
      verdicts: 'strict',
      runManifest: project.runManifest,
      policy: { baseline: project.policy.baseline, outputFile: project.policy.outputFile },
    },
  ];
}

/**
 * The Playwright config for a Gherkin project. It runs only the generated
 * tests, fails flaky tests and `.only`, and adds the Blackbox reporter with
 * strict verdicts, the run manifest and the protected runner-policy baseline
 * from blackbox.feature.yaml (hard rules 4 and 5). It throws when the caller
 * sets any of these itself. A global setup, run before the caller's own,
 * deletes both manifests first, so a run without the Blackbox reporter leaves
 * none for `verify` to mistake for its own. It also throws when a compiled
 * scenario's barrier deadlines, Background included, do not fit inside its
 * test timeout, which would cut them short.
 */
export function defineGherkinConfig(input: GherkinPlaywrightConfig) {
  const { gherkinConfigFile, ...config } = input;
  refuseOwned(config, OWNED, '');
  for (const [index, project] of (config.projects ?? []).entries()) {
    refuseOwned(project, PROJECT_OWNED, ` (projects[${index}])`);
  }
  const project = loadGherkinProject(configFilePath(gherkinConfigFile));
  refuseUnfitDeadlines(project, config);
  return defineConfig({
    ...config,
    blackboxConfigFile: project.blackboxConfigFile,
    testDir: project.outputDir,
    testMatch: GENERATED_TESTS,
    failOnFlakyTests: true,
    forbidOnly: true,
    globalSetup: [clearManifestsFile, ...globalSetupsOf(config.globalSetup)],
    metadata: { ...config.metadata, [MANIFESTS_METADATA_KEY]: [project.runManifest, project.policy.outputFile] },
    reporter: [...reportersOf(config.reporter), strictReporter(project)],
  });
}
