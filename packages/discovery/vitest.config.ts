import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['blackbox-source'] },
  ssr: { resolve: { conditions: ['blackbox-source'] } },
  test: { include: ['src/**/*.test.ts'] },
});
