import { defineConfig } from '../config.js';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: new URL('./system-sandbox', import.meta.url).pathname,
  testMatch: 'failures.spec.ts',
  retries: 0,
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.BLACKBOX_PLAYWRIGHT_JSON_REPORT }],
  ],
});
