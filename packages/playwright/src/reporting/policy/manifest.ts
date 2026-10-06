import { isAbsolute, relative, sep } from 'node:path';

import type { FullConfig, FullProject, Suite } from '@playwright/test/reporter';

import type { BlackboxFixturePolicy } from '../../fixture-lifecycle/timeouts.js';
import { cliSelection, type CliSelection } from './cli-selection.js';

/** defineConfig copies expect.timeout here because FullProject does not expose it. */
export const expectTimeoutsMetadataKey = 'blackboxExpectTimeouts';

/** 2 added `selection`, the CLI test selection. */
export const policySchemaVersion = 2;

type Pattern = string | RegExp | readonly (string | RegExp)[] | null;
type PatternValue = string | readonly string[] | null;

export interface RunPolicy {
  readonly failOnFlakyTests: boolean;
  readonly forbidOnly: boolean;
  readonly fullyParallel: boolean;
  readonly globalTimeout: number;
  readonly grep: PatternValue;
  readonly grepInvert: PatternValue;
  readonly maxFailures: number;
  readonly shard: string | null;
  readonly workers: number;
}

export interface ProjectPolicy {
  readonly retries: number;
  readonly timeout: number;
  /** null when the config was not built with defineConfig from this package. */
  readonly expectTimeout: number | null;
  readonly repeatEach: number;
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

/** Everything compared against the protected baseline. */
export interface EffectivePolicy {
  readonly run: RunPolicy;
  /** CLI test selection; FullConfig's grep and projects hold only the config file's values. */
  readonly selection: CliSelection;
  readonly projects: Readonly<Record<string, ProjectPolicy>>;
  readonly blackbox: BlackboxFixturePolicy;
  /** The selected tests, keyed by project and title path. */
  readonly tests: Readonly<Record<string, TestPolicy>>;
}

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

function projectPolicy(config: FullConfig, project: FullProject, configDir: string): ProjectPolicy {
  return {
    retries: project.retries,
    timeout: project.timeout,
    expectTimeout: expectTimeoutOf(config, project.name),
    repeatEach: project.repeatEach,
    grep: patternValue(project.grep),
    grepInvert: patternValue(project.grepInvert),
    testDir: portablePath(configDir, project.testDir),
    testMatch: patternValue(project.testMatch),
    testIgnore: patternValue(project.testIgnore),
  };
}

function uniqueKey(entries: Record<string, unknown>, name: string): string {
  let key = name;
  for (let index = 2; Object.hasOwn(entries, key); index += 1) {
    key = `${name} (${index})`;
  }
  return key;
}

function projectPolicies(config: FullConfig, configDir: string): Record<string, ProjectPolicy> {
  const projects: Record<string, ProjectPolicy> = {};
  for (const project of config.projects) {
    projects[uniqueKey(projects, project.name)] = projectPolicy(config, project, configDir);
  }
  return projects;
}

function testPolicies(suite: Suite): Record<string, TestPolicy> {
  const tests = suite
    .allTests()
    .map(
      (test) =>
        [
          test
            .titlePath()
            .filter((part) => part.length > 0)
            .join(' › '),
          { retries: test.retries, timeout: test.timeout },
        ] as const,
    )
    .sort(([left], [right]) => left.localeCompare(right));
  // repeatEach copies share one key; the project policy records repeatEach itself.
  return Object.fromEntries(tests);
}

function runPolicy(config: FullConfig): RunPolicy {
  return {
    failOnFlakyTests: config.failOnFlakyTests,
    forbidOnly: config.forbidOnly,
    fullyParallel: config.fullyParallel,
    globalTimeout: config.globalTimeout,
    grep: patternValue(config.grep),
    grepInvert: patternValue(config.grepInvert),
    maxFailures: config.maxFailures,
    shard: config.shard === null ? null : `${config.shard.current}/${config.shard.total}`,
    workers: config.workers,
  };
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
  suite: Suite,
  fixturePolicy: BlackboxFixturePolicy,
  configDir: string,
): PolicyManifest {
  const argv = argvOf(config);
  return {
    schemaVersion: policySchemaVersion,
    argv,
    policy: {
      run: runPolicy(config),
      selection: cliSelection(argv),
      projects: projectPolicies(config, configDir),
      blackbox: { sandboxCleanupTimeoutMs: fixturePolicy.sandboxCleanupTimeoutMs },
      tests: testPolicies(suite),
    },
  };
}
