import { defineConfig } from '../config.js';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: new URL('./system-sandbox', import.meta.url).pathname,
  testMatch: 'happy.spec.ts',
  fullyParallel: true,
  retries: 1,
  workers: 2,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  use: {
    baseURL: 'http://127.0.0.1:1/static-native-base/',
  },
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.BLACKBOX_PLAYWRIGHT_JSON_REPORT }],
  ],
});
