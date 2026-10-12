import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@suites/blackbox-playwright/config';

const project = process.env.BLACKBOX_EFFECTS_TEST_PROJECT;
const results = process.env.BLACKBOX_EFFECTS_TEST_RESULTS;
if (project === undefined || results === undefined) {
  throw new Error('Run these tests through pnpm test:effects');
}

export default defineConfig({
  blackboxConfigFile: join(project, 'blackbox.config.yaml'),
  testDir: import.meta.dirname,
  testMatch: '**/*.spec.ts',
  snapshotPathTemplate: '{testDir}/goldens/{arg}{ext}',
  updateSnapshots: 'none',
  fullyParallel: true,
  workers: 2,
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure' },
  outputDir: join(results, 'output'),
  preserveOutput: 'always',
  reporter: [
    ['list'],
    [fileURLToPath(import.meta.resolve('@suites/blackbox-playwright/reporter'))],
    ['json', { outputFile: join(results, 'results.json') }],
  ],
});
