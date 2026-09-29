import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'fixture-timeout.spec.ts',
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line']],
});
