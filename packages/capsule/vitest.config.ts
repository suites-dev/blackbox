import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/cli/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
  },
});
