import { join } from 'node:path';

import { defineConfig } from '@suites/blackbox-playwright/config';

const results = process.env.BLACKBOX_ASSERTION_RESULTS;
if (results === undefined) {
  throw new Error('BLACKBOX_ASSERTION_RESULTS is required');
}

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: join(import.meta.dirname, 'tests/playwright-assertions'),
  testMatch: '*.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 20_000,
  outputDir: join(results, 'output'),
  reporter: [['list'], ['json', { outputFile: join(results, 'results.json') }]],
});
