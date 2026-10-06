import { isAbsolute, relative, sep } from 'node:path';

import type { FullConfig, FullProject, Suite } from '@playwright/test/reporter';

import {
  defaultFixturePolicy,
  type BlackboxFixturePolicy,
} from '../../fixture-lifecycle/timeouts.js';
import { cliSelection, type CliSelection } from './cli-selection.js';

/** defineConfig copies expect.timeout here because FullProject does not expose it. */
export const expectTimeoutsMetadataKey = 'blackboxExpectTimeouts';

/**
 * 2 added `selection`, the CLI test selection. 3 keeps only what can change a verdict
 * (workers, retries, timeouts, test selection and the Sandbox cleanup timeout), omits
 * defaults, and lists a test only when its retries or timeout differ from its project's.
 */
export const policySchemaVersion = 3;

type Pattern = string | RegExp | readonly (string | RegExp)[] | null;
type PatternValue = string | readonly string[] | null;

/** Playwright's defaults; a field at its default is omitted from the policy. */
const defaults = {
  globalTimeout: 0,
  grep: '/.*/',
  retries: 0,
  timeout: 30_000,
  expectTimeout: 5_000,
  testDir: '.',
  testMatch: '**/*.@(spec|test).?(c|m)[jt]s?(x)',
} as const;

export interface RunPolicy {
  readonly workers: number;
  readonly globalTimeout: number;
  readonly grep: PatternValue;
  readonly grepInvert: PatternValue;
  readonly shard: string;
}

export interface ProjectPolicy {
  readonly retries: number;
  readonly timeout: number;
  /** Known only when the config was built with defineConfig from this package. */
  readonly expectTimeout: number;
  readonly grep: PatternValue;
  readonly grepInvert: PatternValue;
  readonly testDir: string;
  readonly testMatch: PatternValue;
  readonly testIgnore: PatternValue;
}

export interface TestPolicy {
  readonly retries: number;
  readonly timeout: number;
}

/** Everything compared against the protected baseline. Fields at their default are omitted. */
export type EffectivePolicy = Readonly<
  Pick<RunPolicy, 'workers'> &
    Partial<Omit<RunPolicy, 'workers'>> &
    Partial<{
      /** CLI test selection; FullConfig's grep and projects hold only the config file's values. */
      readonly selection: Partial<CliSelection>;
      readonly sandboxCleanupTimeoutMs: number;
      /** Tests whose retries or timeout differ from their project's, keyed by project and title path. */
      readonly tests: Readonly<Record<string, Partial<TestPolicy>>>;
    }> & {
      readonly projects: Readonly<Record<string, Partial<ProjectPolicy>>>;
    }
>;

export interface PolicyManifest {
  readonly schemaVersion: typeof policySchemaVersion;
  /** Recorded and printed, never compared: it holds machine paths; its selection flags are in `policy.selection`. */
  readonly argv: readonly string[];
  readonly policy: EffectivePolicy;
}

function patternValue(pattern: Pattern): PatternValue {
  if (pattern === null) {
    return null;
  }
  if (typeof pattern === 'string' || pattern instanceof RegExp) {
    return String(pattern);
  }
  return pattern.map(String);
}

/** Keeps the entries that are set and not at their default: not null, false, empty or equal to it. */
function withoutDefaults<T extends object>(
  entries: readonly (readonly [keyof T & string, unknown, unknown])[],
): Partial<T> {
  const kept = entries.filter(([, value, fallback]) => {
    if (value === null || value === false || (Array.isArray(value) && value.length === 0)) {
      return false;
    }
    return JSON.stringify(value) !== JSON.stringify(fallback);
  });
  return Object.fromEntries(kept.map(([key, value]) => [key, value])) as Partial<T>;
}

function portablePath(root: string, path: string): string {
  const relativePath = relative(root, path);
  if (relativePath.length === 0) {
    return '.';
  }
  return isAbsolute(relativePath) ? relativePath : relativePath.split(sep).join('/');
}

function expectTimeoutOf(config: FullConfig, projectName: string): number | null {
  const recorded: unknown = config.metadata[expectTimeoutsMetadataKey];
  if (typeof recorded !== 'object' || recorded === null || !Object.hasOwn(recorded, projectName)) {
    return null;
  }
  const value: unknown = (recorded as Record<string, unknown>)[projectName];
  return typeof value === 'number' ? value : null;
}

function projectPolicy(
  config: FullConfig,
  project: FullProject,
  configDir: string,
): Partial<ProjectPolicy> {
  return withoutDefaults<ProjectPolicy>([
    ['retries', project.retries, defaults.retries],
    ['timeout', project.timeout, defaults.timeout],
    ['expectTimeout', expectTimeoutOf(config, project.name), defaults.expectTimeout],
    ['grep', patternValue(project.grep), defaults.grep],
    ['grepInvert', patternValue(project.grepInvert), null],
    ['testDir', portablePath(configDir, project.testDir), defaults.testDir],
    ['testMatch', patternValue(project.testMatch), defaults.testMatch],
    ['testIgnore', patternValue(project.testIgnore), null],
  ]);
}

function uniqueKey(entries: Record<string, unknown>, name: string): string {
  let key = name;
  for (let index = 2; Object.hasOwn(entries, key); index += 1) {
    key = `${name} (${index})`;
  }
  return key;
}

function projectPolicies(
  config: FullConfig,
  configDir: string,
): Record<string, Partial<ProjectPolicy>> {
  const projects: Record<string, Partial<ProjectPolicy>> = {};
  for (const project of config.projects) {
    projects[uniqueKey(projects, project.name)] = projectPolicy(config, project, configDir);
  }
  return projects;
}

/** The root suite as the policy reads it: one child suite per project. */
export interface ProjectSuites {
  readonly suites: readonly Pick<Suite, 'project' | 'allTests'>[];
}

/** Tests whose retries or timeout differ from their project's, with only the fields that differ. */
function testPolicies(suite: ProjectSuites): Record<string, Partial<TestPolicy>> {
  const tests: (readonly [string, Partial<TestPolicy>])[] = [];
  for (const projectSuite of suite.suites) {
    const project = projectSuite.project();
    if (project === undefined) {
      continue;
    }
    for (const test of projectSuite.allTests()) {
      const own = withoutDefaults<TestPolicy>([
        ['retries', test.retries, project.retries],
        ['timeout', test.timeout, project.timeout],
      ]);
      if (Object.keys(own).length > 0) {
        const key = test
          .titlePath()
          .filter((part) => part.length > 0)
          .join(' › ');
        tests.push([key, own]);
      }
    }
  }
  // repeatEach copies share one key.
  return Object.fromEntries(tests.sort(([left], [right]) => left.localeCompare(right)));
}

function runPolicy(config: FullConfig): Partial<RunPolicy> {
  return withoutDefaults<RunPolicy>([
    ['globalTimeout', config.globalTimeout, defaults.globalTimeout],
    ['grep', patternValue(config.grep), defaults.grep],
    ['grepInvert', patternValue(config.grepInvert), null],
    ['shard', config.shard === null ? null : `${config.shard.current}/${config.shard.total}`, null],
  ]);
}

function argvOf(config: FullConfig): string[] {
  // FullConfig.argv is newer than the oldest supported peer; older runners omit it.
  const argv: unknown = config.argv;
  return Array.isArray(argv) ? argv.map(String) : [];
}

/**
 * Capture the policy Playwright resolved from config, CLI flags, and test declarations.
 * Project test directories are recorded relative to the config directory, so moving
 * testDir is drift; FullConfig.rootDir would move with it.
 */
export function capturePolicy(
  config: FullConfig,
  suite: ProjectSuites,
  fixturePolicy: BlackboxFixturePolicy,
  configDir: string,
): PolicyManifest {
  const argv = argvOf(config);
  const selection = withoutDefaults<CliSelection>(
    Object.entries(cliSelection(argv)).map(
      ([key, value]) => [key as keyof CliSelection, value, null] as const,
    ),
  );
  const tests = testPolicies(suite);
  return {
    schemaVersion: policySchemaVersion,
    argv,
    policy: {
      workers: config.workers,
      ...runPolicy(config),
      ...(Object.keys(selection).length > 0 ? { selection } : {}),
      projects: projectPolicies(config, configDir),
      ...withoutDefaults<{ sandboxCleanupTimeoutMs: number }>([
        [
          'sandboxCleanupTimeoutMs',
          fixturePolicy.sandboxCleanupTimeoutMs,
          defaultFixturePolicy.sandboxCleanupTimeoutMs,
        ],
      ]),
      ...(Object.keys(tests).length > 0 ? { tests } : {}),
    },
  };
}
