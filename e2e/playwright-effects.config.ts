import { join } from 'node:path';

import { defineConfig } from '@suites/blackbox-playwright/config';

const resultsRoot = process.env.BLACKBOX_E2E_RESULTS_ROOT;
if (!resultsRoot) {
  throw new Error('BLACKBOX_E2E_RESULTS_ROOT is required');
}

export default defineConfig({
  blackboxConfigFile: join(import.meta.dirname, 'effects-acceptance', 'blackbox.config.yaml'),
  testDir: join(import.meta.dirname, 'effects-acceptance', 'tests'),
  testMatch: '**/*.spec.ts',
  snapshotPathTemplate: '{testDir}/goldens/{arg}{ext}',
  updateSnapshots: 'none',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure' },
  outputDir: join(resultsRoot, 'effects', 'output'),
  preserveOutput: 'always',
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
    ['json', { outputFile: join(resultsRoot, 'effects', 'results.json') }],
  ],
});
