import { join } from 'node:path';

import { defineGherkinConfig } from '@suites/blackbox-gherkin/config';

// Runs the tests that `blackbox feature compile` generates from features/.
// defineGherkinConfig owns the test files, strict verdicts, the run manifest
// and the runner-policy baseline (blackbox.feature.yaml); this file sets only
// what that leaves to the project.
const resultsRoot = join(import.meta.dirname, 'test-results', 'gherkin');

export default defineGherkinConfig({
  gherkinConfigFile: new URL('./blackbox.feature.yaml', import.meta.url),
  fullyParallel: true,
  // Exercise concurrent sandboxes without exhausting the Docker CI runner.
  workers: 2,
  retries: 0,
  timeout: 180_000,
  preserveOutput: 'always',
  outputDir: join(resultsRoot, 'output'),
  reporter: [
    ['list', { printSteps: true }],
    ['junit', { outputFile: join(resultsRoot, 'junit.xml') }],
    ['json', { outputFile: join(resultsRoot, 'results.json') }],
  ],
});
