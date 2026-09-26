import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    pool: 'forks',
    testTimeout: 120_000,
  },
});
