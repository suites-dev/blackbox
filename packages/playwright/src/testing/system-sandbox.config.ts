import { defineConfig } from '../config.js';

const serializedControl =
  process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO === 'serialized-control';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: new URL('./system-sandbox', import.meta.url).pathname,
  testMatch: 'happy.spec.ts',
  fullyParallel: true,
  retries: serializedControl ? 0 : 1,
  workers: serializedControl ? 1 : 2,
  ...(serializedControl
    ? {
        grep: /fixtureless acquisition keeps native steps|hooks body and native request share one attempt/u,
      }
    : {}),
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  use: {
    baseURL: 'http://127.0.0.1:1/static-native-base/',
  },
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.BLACKBOX_PLAYWRIGHT_JSON_REPORT }],
  ],
});
