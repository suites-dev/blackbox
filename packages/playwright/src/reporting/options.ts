import { fileURLToPath } from 'node:url';

import type { PlaywrightTestConfig } from '@playwright/test';
import type { FullConfig } from '@playwright/test/reporter';

export const sandboxLifecycleMetadataKey = 'blackboxSandboxLifecycle';

const reporterSpecifiers = new Set([
  '@suites/blackbox/playwright/reporter',
  '@suites/blackbox-playwright/reporter',
]);
const reporterFiles = new Set([
  fileURLToPath(new URL('../reporter.js', import.meta.url)),
  fileURLToPath(new URL('../reporter.ts', import.meta.url)),
]);

function isBlackboxReporter(specifier: string): boolean {
  return reporterSpecifiers.has(specifier) || reporterFiles.has(specifier);
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
