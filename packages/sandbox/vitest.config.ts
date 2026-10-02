import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.fixture.ts', 'src/index.ts', 'src/model/**'],
      reporter: ['text', 'json-summary'],
    },
  },
});
