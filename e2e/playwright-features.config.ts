import { join } from 'node:path';

import { defineConfig } from '@suites/blackbox-playwright/config';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const resultsRoot = requiredEnvironment('BLACKBOX_FEATURE_RESULTS_ROOT');
const mode = requiredEnvironment('BLACKBOX_FEATURE_MODE');
if (!['retained-first', 'retained-second', 'default-off', 'write-failure'].includes(mode)) {
  throw new Error(`Unknown Playwright feature mode: ${mode}`);
}
// Omitting the option in default-off exercises the shipped fixture default.
const use = {
  trace: 'off' as const,
  ...(mode === 'default-off' ? {} : { blackboxRetainAttempts: true }),
};

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: join(import.meta.dirname, 'tests', 'playwright-features'),
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  preserveOutput: 'always',
  outputDir: requiredEnvironment('BLACKBOX_FEATURE_OUTPUT_DIR'),
  use,
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
    ['json', { outputFile: join(resultsRoot, 'results.json') }],
    ['junit', { outputFile: join(resultsRoot, 'junit.xml') }],
  ],
});
