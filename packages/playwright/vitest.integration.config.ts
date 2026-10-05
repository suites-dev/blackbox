import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
  },
});
