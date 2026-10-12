import { defineConfig } from '../config.js';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: new URL('./body-phase', import.meta.url).pathname,
  testMatch: 'body-phase.spec.ts',
  fullyParallel: true,
  retries: 1,
  workers: 2,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line'], ['json', { outputFile: process.env.BLACKBOX_PLAYWRIGHT_JSON_REPORT }]],
});
