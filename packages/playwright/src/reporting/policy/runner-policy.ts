import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { FullConfig, Suite } from '@playwright/test/reporter';
import { stringify } from 'yaml';

import { defaultFixturePolicy } from '../../fixture-lifecycle/timeouts.js';
import type { PolicySettings } from '../options.js';
import { compareWithBaseline } from './compare.js';
import { capturePolicy } from './manifest.js';
import { policyReport, verificationFailure } from './render.js';

export interface RunnerPolicyResult {
  /** Printed at the start of the run and attached to each test. */
  readonly report: string;
  /** Null when the effective policy is verified or verification is not configured. */
  readonly failure: string | null;
}

/**
 * Capture the effective runner policy, write it when requested, and compare it with
 * the protected baseline. Paths resolve from the config directory, as Playwright's
 * own reporter paths do.
 */
export function evaluateRunnerPolicy(
  config: FullConfig,
  suite: Suite,
  settings: PolicySettings,
  configDir: string,
): RunnerPolicyResult {
  const manifest = capturePolicy(config, suite, defaultFixturePolicy, configDir);
  if (settings.outputFile !== null) {
    const outputFile = resolve(configDir, settings.outputFile);
    mkdirSync(dirname(outputFile), { recursive: true });
    // YAML, like the baseline: accepting a change is copying this file over it.
    writeFileSync(outputFile, stringify(manifest, { lineWidth: 0 }));
  }
  const comparison = compareWithBaseline(manifest, settings.baseline, configDir);
  return {
    report: policyReport(manifest, comparison, suite.allTests().length),
    failure: verificationFailure(comparison),
  };
}
