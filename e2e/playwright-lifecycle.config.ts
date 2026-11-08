import { join } from 'node:path';
import { defineConfig } from '@suites/blackbox-playwright/config';
import * as clients from './.blackbox/clients/index.js';
import { blackboxEnvironment } from './tests/playwright/support.js';

const results = process.env.BLACKBOX_E2E_RESULTS_ROOT;
if (results === undefined) { throw new Error('BLACKBOX_E2E_RESULTS_ROOT is required'); }
export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: join(import.meta.dirname, 'tests/playwright-lifecycle'),
  testMatch: '*.spec.ts',
  use: {
    blackbox: { system: 'subscription-system', environment: blackboxEnvironment, clients },
  },
  workers: 1,
  retries: 0,
  timeout: 180_000,
  preserveOutput: 'always',
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  outputDir: join(results, 'lifecycle/output'),
  reporter: [['list', { printSteps: true }], ['json', { outputFile: join(results, 'lifecycle/results.json') }]],
});
