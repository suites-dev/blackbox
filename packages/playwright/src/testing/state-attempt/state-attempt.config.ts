import { defineConfig } from '../../config.js';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: import.meta.dirname,
  testMatch: 'state-attempt.spec.ts',
  retries: 0,
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line']],
});
