import { test as blackboxTest } from '@suites/blackbox-playwright';

import type { ScenarioWorld } from './step-types.js';

// Named through the public facade: @suites/blackbox-playwright does not export the facade's type.
type ScenarioTest = ReturnType<typeof blackboxTest.extend<{ world: ScenarioWorld }>>;

/**
 * The public Blackbox facade plus a scenario-local `world`. Each physical
 * attempt gets a fresh world, shared by its Background hooks and test body.
 */
export const test: ScenarioTest = blackboxTest.extend<{ world: ScenarioWorld }>({
  // Playwright reads fixture dependencies from the destructuring pattern; world has none.
  // eslint-disable-next-line no-empty-pattern
  world: async ({}, use) => {
    await use(new Map());
  },
});
