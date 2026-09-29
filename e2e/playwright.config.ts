import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const resultsRoot = requiredEnvironment('BLACKBOX_E2E_RESULTS_ROOT');

export default defineConfig({
  testDir: join(import.meta.dirname, 'tests', 'playwright'),
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 180_000,
  preserveOutput: 'always',
  outputDir: join(resultsRoot, 'output'),
  reporter: [
    ['line'],
    ['junit', { outputFile: join(resultsRoot, 'junit.xml') }],
    ['json', { outputFile: join(resultsRoot, 'results.json') }],
  ],
});
