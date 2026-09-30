import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'physical-attempts.spec.ts',
  retries: 1,
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line']],
});
