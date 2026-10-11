import { join } from 'node:path';

import { defineConfig } from '@suites/blackbox-playwright/config';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const resultsRoot = requiredEnvironment('BLACKBOX_E2E_RESULTS_ROOT');

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: join(import.meta.dirname, 'tests', 'features-suites'),
  testMatch: '*.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 180_000,
  preserveOutput: 'always',
  outputDir: join(resultsRoot, 'feature-suites-output'),
  use: {
    blackboxEnvironment: {
      FIXTURE_CONTROL_TOKEN: requiredEnvironment('BLACKBOX_E2E_FIXTURE_TOKEN'),
    },
  },
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
    ['json', { outputFile: join(resultsRoot, 'feature-suites-results.json') }],
    ['junit', { outputFile: join(resultsRoot, 'feature-suites-junit.xml') }],
  ],
});
