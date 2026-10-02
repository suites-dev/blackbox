import { join } from 'node:path';

import { defineConfig } from '../config.js';

const project = process.env.BLACKBOX_TEST_PROJECT;
if (project === undefined) {
  throw new Error('BLACKBOX_TEST_PROJECT must name a disposable project directory');
}

export default defineConfig({
  blackboxConfigFile: join(project, 'blackbox.config.yaml'),
  testDir: join(import.meta.dirname, 'retention'),
  testMatch: 'retention.spec.ts',
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line']],
  use: { blackboxRetainAttempts: process.env.BLACKBOX_TEST_RETAIN === 'on' },
});
