import { join } from 'node:path';

import { defineConfig } from '@suites/blackbox-playwright/config';

// This opt-in config leaves the existing eight-scenario acceptance lane intact.
export default defineConfig({
  blackboxConfigFile: join(import.meta.dirname, '..', 'blackbox.config.yaml'),
  testDir: import.meta.dirname,
  tsconfig: join(import.meta.dirname, 'tsconfig.json'),
  testMatch: 'gherkin-executable-spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 180_000,
  preserveOutput: 'always',
  outputDir: join(import.meta.dirname, '..', 'test-results', 'gherkin-example'),
  reporter: [['list', { printSteps: true }], ['@suites/blackbox-playwright/reporter']],
});
