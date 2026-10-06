import { join } from 'node:path';

import { defineConfig } from '../config.js';

const output = process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR;
if (output === undefined) {
  throw new Error('Missing output directory');
}
const strict = process.env.BLACKBOX_TEST_VERDICTS === 'strict';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: new URL('./verdicts', import.meta.url).pathname,
  testMatch: 'verdicts.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 1,
  maxFailures: process.env.BLACKBOX_TEST_MAX_FAILURES === '1' ? 1 : 0,
  outputDir: join(output, 'attempts'),
  reporter: [
    ['list'],
    [
      join(import.meta.dirname, '../reporter.ts'),
      strict
        ? {
            sandboxLifecycle: false,
            verdicts: 'strict',
            runManifest: join(output, 'manifest', 'blackbox-run.json'),
          }
        : { sandboxLifecycle: false },
    ],
  ],
});
