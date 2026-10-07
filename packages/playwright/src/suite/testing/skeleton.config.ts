import { defineConfig } from '../../config.js';

// The Playwright configuration skeleton-run.test.ts runs a rendered suite with.
// The suite is written to a temporary directory, which the test passes in.

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: process.env.BLACKBOX_SKELETON_DIR,
  retries: 0,
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line'], ['json', { outputFile: process.env.BLACKBOX_PLAYWRIGHT_JSON_REPORT }]],
});
