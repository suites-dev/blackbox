import { test as blackboxTest } from '@suites/blackbox-playwright';

import type { ScenarioWorld } from './step-types.js';

// Preserve the native extended TestType in the package declaration.
type ScenarioTest = ReturnType<typeof blackboxTest.extend<{ world: ScenarioWorld }>>;

/**
 * The native Blackbox test plus a scenario-local `world`. Each physical
 * attempt gets a fresh world, shared by its Background hooks and test body.
 */
export const test: ScenarioTest = blackboxTest.extend<{ world: ScenarioWorld }>({
  // Playwright reads fixture dependencies from the destructuring pattern; world has none.
  // eslint-disable-next-line no-empty-pattern
  world: async ({}, use) => {
    await use(new Map());
  },
});
