import { join } from 'node:path';
import { defineConfig } from '@suites/blackbox-playwright/config';
import { postgres } from './.blackbox/clients/postgres.js';
import { redis } from './.blackbox/clients/redis.js';

const results = process.env.BLACKBOX_PAYMENT_RESULTS;
if (!results) {
  throw new Error('BLACKBOX_PAYMENT_RESULTS is required');
}
export default defineConfig({
  blackboxConfigFile: './blackbox-payment.yaml',
  testDir: './tests/playwright-payment',
  use: { blackbox: { system: 'payment-system', clients: { postgres, redis } } },
  workers: 1,
  retries: 0,
  timeout: 180_000,
  preserveOutput: 'always',
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  outputDir: join(results, 'output'),
  reporter: [
    ['@suites/blackbox-playwright/reporter'],
    ['list', { printSteps: true }],
    ['json', { outputFile: join(results, 'results.json') }],
    ['html', { open: 'never', outputFolder: join(results, 'html') }],
  ],
});
