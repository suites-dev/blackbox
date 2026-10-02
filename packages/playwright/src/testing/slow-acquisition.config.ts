import { join } from 'node:path';

import { defineConfig } from '../config.js';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: join(import.meta.dirname, 'slow-acquisition'),
  testMatch: 'slow-acquisition.spec.ts',
  workers: 1,
  outputDir: process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR,
  reporter: [['line']],
});
