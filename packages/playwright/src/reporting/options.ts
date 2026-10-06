import { fileURLToPath } from 'node:url';

import type { PlaywrightTestConfig } from '@playwright/test';
import type { FullConfig } from '@playwright/test/reporter';

export const sandboxLifecycleMetadataKey = 'blackboxSandboxLifecycle';

const reporterSpecifier = '@suites/blackbox-playwright/reporter';
const reporterFiles = new Set([
  fileURLToPath(new URL('../reporter.js', import.meta.url)),
  fileURLToPath(new URL('../reporter.ts', import.meta.url)),
]);

function isBlackboxReporter(specifier: string): boolean {
  return specifier === reporterSpecifier || reporterFiles.has(specifier);
}

interface BlackboxPolicyFields {
  /**
   * Protected baseline manifest, relative to the config directory. Any difference from
   * the effective runner policy fails the run.
   */
  readonly baseline: string;
  /** Where to write the effective runner-policy manifest, relative to the config directory. */
  readonly outputFile: string;
}

export interface PolicySettings {
  readonly baseline: string | null;
  readonly outputFile: string | null;
}

function optionsObject(options: unknown): object {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error('Blackbox reporter options must be an object');
  }
  return options;
}

function pathSetting(policy: object, key: keyof BlackboxPolicyFields): string | null {
  const value: unknown = key in policy ? (policy as Record<string, unknown>)[key] : undefined;
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Blackbox reporter policy.${key} must be a non-empty path`);
  }
  return value;
}

/**
 * Reads `policy: { baseline?, outputFile? }`. The policy is printed on every run;
 * `baseline` turns on verification.
 */
export function policyOption(input: unknown = {}): PolicySettings {
  const options = optionsObject(input);
  const policy: unknown = 'policy' in options ? options.policy : undefined;
  if (policy === undefined) {
    return { baseline: null, outputFile: null };
  }
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw new Error('Blackbox reporter policy must be an object');
  }
  return {
    baseline: pathSetting(policy, 'baseline'),
    outputFile: pathSetting(policy, 'outputFile'),
  };
}

export function sandboxLifecycleOption(input: unknown = {}): boolean {
  const options = optionsObject(input);
  const value: unknown = 'sandboxLifecycle' in options ? options.sandboxLifecycle : undefined;
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'boolean') {
    throw new Error('Blackbox reporter sandboxLifecycle must be a boolean');
  }
  return value;
}

/**
 * Reads `verdicts: 'strict'` and its required `runManifest` path, relative to the config
 * directory. Strict verdicts fail the run unless every test is supported: one attempt,
 * expected to pass, passed. Provisional names; they settle with the options reshaped by #123.
 */
export function strictVerdictsOption(
  input: unknown = {},
): { readonly kind: 'off' } | { readonly kind: 'strict'; readonly runManifest: string } {
  const options = optionsObject(input);
  const verdicts: unknown = 'verdicts' in options ? options.verdicts : undefined;
  const runManifest: unknown = 'runManifest' in options ? options.runManifest : undefined;
  if (verdicts === undefined) {
    if (runManifest !== undefined) {
      throw new Error('Blackbox reporter runManifest requires verdicts: "strict"');
    }
    return { kind: 'off' };
  }
  if (verdicts !== 'strict') {
    throw new Error('Blackbox reporter verdicts must be "strict"');
  }
  if (typeof runManifest !== 'string' || runManifest.trim() === '') {
    throw new Error('Blackbox reporter runManifest must be a non-empty path');
  }
  return { kind: 'strict', runManifest };
}

export function sandboxLifecycleConfigured(reporter: PlaywrightTestConfig['reporter']): boolean {
  if (typeof reporter === 'string') {
    return isBlackboxReporter(reporter);
  }
  if (reporter === undefined) {
    return false;
  }
  const entry = reporter.find(([specifier]) => isBlackboxReporter(specifier));
  return entry !== undefined && sandboxLifecycleOption(entry[1]);
}

export function sandboxLifecycleEnabled(config: Pick<FullConfig, 'metadata'>): boolean {
  return config.metadata[sandboxLifecycleMetadataKey] === true;
}
