import { fileURLToPath } from 'node:url';

import type { FullConfig } from '@playwright/test/reporter';

export interface BlackboxReporterOptions {
  /** Print ready/cleanup messages through Playwright's per-test stdout. Default: true. */
  readonly sandboxLifecycle: boolean;
}

export function sandboxLifecycleOption(options: unknown = {}): boolean {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error('Blackbox reporter options must be an object');
  }
  const value: unknown = 'sandboxLifecycle' in options ? options.sandboxLifecycle : undefined;
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'boolean') {
    throw new Error('Blackbox reporter sandboxLifecycle must be a boolean');
  }
  return value;
}

export function sandboxLifecycleEnabled(config: Pick<FullConfig, 'reporter'>): boolean {
  const reporterFile = fileURLToPath(new URL('../reporter.js', import.meta.url));
  const entry = config.reporter.find(
    ([file]) => file === reporterFile || file === reporterFile.replace(/\.js$/u, '.ts'),
  );
  return entry !== undefined && sandboxLifecycleOption(entry[1]);
}
