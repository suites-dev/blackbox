import { join, relative } from 'node:path';

import { defineConfig } from '../../config.js';

const output = process.env.BLACKBOX_PLAYWRIGHT_OUTPUT_DIR;
if (output === undefined) {
  throw new Error('Missing output directory');
}
// Each variant changes one runner-policy input that baseline.yaml pins.
const variant = process.env.BLACKBOX_TEST_POLICY_VARIANT ?? 'baseline';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  // testDir differs from the config directory, so option paths prove where they resolve from.
  testDir: variant === 'test-dir' ? import.meta.dirname : './tests',
  testMatch: 'policy.spec.ts',
  workers: 1,
  retries: variant === 'retries' ? 2 : 1,
  timeout: variant === 'timeout' ? 45_000 : 30_000,
  ...(variant === 'grep' ? { grep: /alpha/u } : {}),
  expect: { timeout: variant === 'expect-timeout' ? 9000 : 5000 },
  outputDir: join(output, 'attempts'),
  projects: [{ name: 'primary' }, ...(variant === 'projects' ? [] : [{ name: 'secondary' }])],
  reporter: [
    [
      join(import.meta.dirname, '../../reporter.ts'),
      {
        sandboxLifecycle: false,
        policy: {
          baseline: process.env.BLACKBOX_TEST_POLICY_BASELINE ?? './baseline.yaml',
          outputFile: relative(import.meta.dirname, join(output, 'blackbox-policy.yaml')),
        },
      },
    ],
    ['json', { outputFile: join(output, 'results.json') }],
  ],
});
