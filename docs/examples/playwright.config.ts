import { defineConfig } from '@suites/blackbox-playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: '.',
  testMatch: 'subscriptions.spec.ts',
  fullyParallel: true,
  workers: 1,
  timeout: 180_000,
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
    ['html', { open: 'never' }],
  ],
});
