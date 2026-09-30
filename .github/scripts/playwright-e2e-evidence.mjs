#!/usr/bin/env node
import { retainE2eEvidence } from './e2e-evidence.mjs';

retainE2eEvidence({
  outputDir: '.blackbox/tmp/ci-playwright-e2e-transport',
  testOutcome: process.env.E2E_TEST_OUTCOME || 'not-run',
  project: 'playwright',
})
  .then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    process.exitCode = receipt.status === 'complete' ? 0 : 1;
  })
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
