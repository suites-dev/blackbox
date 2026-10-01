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
    [join(import.meta.dirname, '../../reporter.ts')],
    ['json', { outputFile: join(output, 'results.json') }],
  ],
});
