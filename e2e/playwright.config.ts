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
  testDir: join(import.meta.dirname, 'tests', 'playwright'),
  testMatch: '*.spec.ts',
  fullyParallel: true,
  // Exercise concurrent sandboxes without exhausting the Docker CI runner.
  workers: 2,
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { serviceWorkers: 'block', trace: 'retain-on-failure' },
  preserveOutput: 'always',
  outputDir: join(resultsRoot, 'output'),
  reporter: [
    ['list', { printSteps: true }],
    // Adds retained, readable Blackbox diagnostics.
    ['@suites/blackbox-playwright/reporter'],
    // Maintainer-only recorder for Blackbox's 8-test acceptance journey;
    // ordinary consumers do not need to add it.
    [join(import.meta.dirname, 'reporters', 'blackbox-evidence.ts')],
    ['junit', { outputFile: join(resultsRoot, 'junit.xml') }],
    ['json', { outputFile: join(resultsRoot, 'results.json') }],
    ['html', { outputFolder: join(resultsRoot, 'html'), open: 'never' }],
  ],
});
