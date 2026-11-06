import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: join(import.meta.dirname, 'assertion-accounting'),
  testMatch: '*.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 5_000,
  outputDir: process.env.BLACKBOX_ASSERTION_OUTPUT,
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  updateSnapshots: 'none',
  reporter: [['line'], ['json', { outputFile: process.env.BLACKBOX_ASSERTION_REPORT }]],
});
