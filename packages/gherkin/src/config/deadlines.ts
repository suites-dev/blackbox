import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { defineConfig } from '@suites/blackbox-playwright/config';

import { MANIFEST_FILE, type BarrierDeadline, type CompiledScenario } from '../compiler/manifest.js';
import { isObject } from '../project/reader.js';

// A barrier's only deadline is the one its reviewed feature states. The test
// timeout bounds the whole scenario, so a scenario whose barrier deadlines
// (Background included) reach the timeout would have them cut silently. The
// config refuses that before any test or Sandbox starts (benchmark F4).

/** Playwright's test timeout when neither the config nor a project sets one. */
const DEFAULT_TIMEOUT_MS = 30_000;

type Scenario = Pick<CompiledScenario, 'feature' | 'line' | 'titlePath' | 'barrierDeadlines'>;

export interface ProjectTimeout {
  /** Null for a config without projects. */
  readonly project: string | null;
  /** Milliseconds; 0 means no timeout. */
  readonly timeout: number;
}

const isDeadline = (value: unknown): value is BarrierDeadline =>
  isObject(value) && typeof value.line === 'number' && typeof value.seconds === 'number';

function isScenario(value: unknown): value is Scenario {
  return (
    isObject(value) &&
    typeof value.feature === 'string' &&
    typeof value.line === 'number' &&
    Array.isArray(value.titlePath) &&
    Array.isArray(value.barrierDeadlines) &&
    value.barrierDeadlines.every(isDeadline)
  );
}

/** The scenarios compiled into `outputDir`, or none before the first compile. */
export function compiledScenarios(outputDir: string): readonly Scenario[] {
  const file = join(outputDir, MANIFEST_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const manifest: unknown = JSON.parse(text);
  if (!isObject(manifest) || !Array.isArray(manifest.scenarios) || !manifest.scenarios.every(isScenario)) {
    throw new Error(`${file} is not a compile manifest; run blackbox feature compile`);
  }
  return manifest.scenarios;
}

type PlaywrightConfig = Parameters<typeof defineConfig>[0];

/** The effective test timeout of each project, as Playwright resolves it from the config. */
export function projectTimeouts(config: Pick<PlaywrightConfig, 'timeout' | 'projects'>): readonly ProjectTimeout[] {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  if (config.projects === undefined) {
    return [{ project: null, timeout }];
  }
  return config.projects.map((project) => ({ project: project.name ?? '', timeout: project.timeout ?? timeout }));
}

/** One line per scenario and project whose barrier deadlines do not fit inside the test timeout. */
export function unfitDeadlines(scenarios: readonly Scenario[], timeouts: readonly ProjectTimeout[]): readonly string[] {
  return scenarios.flatMap((scenario) => {
    const seconds = scenario.barrierDeadlines.reduce((total, deadline) => total + deadline.seconds, 0);
    const stated = scenario.barrierDeadlines.map((deadline) => `${deadline.seconds} s at line ${deadline.line}`).join(', ');
    return timeouts
      .filter(({ timeout }) => timeout !== 0 && seconds > 0 && seconds * 1000 >= timeout)
      .map(
        ({ project, timeout }) =>
          `${scenario.feature}:${scenario.line} ${scenario.titlePath.slice(1).join(' › ')}: barrier deadlines of ${seconds} s (${stated}) do not fit the ${timeout} ms test timeout${project === null ? '' : ` of project "${project}"`}`,
      );
  });
}
