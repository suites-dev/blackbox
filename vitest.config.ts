import { defineConfig } from 'vitest/config';

/**
 * Repository-level Vitest entrypoint.
 *
 * Each workspace package owns its runtime, include patterns, and timeouts in a
 * local `vitest.config.ts`. The root only composes those projects, so adding a
 * package does not require restoring a central package allowlist.
 *
 * Packages using another runner, such as the oclif package's `node --test`
 * suite, continue to run through their package `test` script and are not
 * misrepresented as Vitest projects here.
 */
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});
