import { join } from 'node:path';

import { defineConfig } from '../../config.js';

const output = process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR;
if (output === undefined) {
  throw new Error('Missing output directory');
}

export default defineConfig({
  blackboxConfigFile: './catalog/custom.yaml',
  testDir: import.meta.dirname,
  testMatch: 'reporting.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 1,
  outputDir: join(output, 'attempts'),
  reporter: [
    ...(process.env.BLACKBOX_TEST_NATIVE_REPORTER === 'auto'
      ? []
      : [['list', { printSteps: true }] as const]),
    [
      join(import.meta.dirname, '../../reporter.ts'),
      {
        sandboxLifecycle: process.env.BLACKBOX_TEST_LIFECYCLE === 'off' ? false : undefined,
      },
    ],
    [join(import.meta.dirname, 'progress-observer.ts')],
    ['json', { outputFile: join(output, 'results.json') }],
  ],
});
