import { compilerTestLibrary } from '../../library/testing/compiler-steps.js';
import { createStepRunner } from '../../runtime/run-step.js';
import { test as scenarioTest } from '../../runtime/scenario-test.js';
import type { ScenarioWorld, StepFixtures } from '../../runtime/step-types.js';

// The generated-code runtime for a real Playwright run without Docker. It is the
// package runtime with two test-only substitutions: steps resolve against the
// test vocabulary with stub bodies, and the facade's Sandbox acquisition fixture
// yields no attempt. Everything else is the real facade: test.system(...).sandbox(...)
// declarations, Background hooks, the scenario world and boxed native steps. The
// stub steps read only `world`, so no test asks for a Sandbox. If the overridden
// fixture is renamed, the production runtime acquires a Sandbox again and the run
// fails without a catalog, so the substitution cannot silently stop applying.

export { sandboxCredentials } from '../../runtime/credentials.js';
export { sandboxEnvironment } from '../../runtime/environment.js';

export const test = scenarioTest.extend<{ readonly _blackboxAttempt: { readonly kind: 'unselected' } }>({
  _blackboxAttempt: [
    // Playwright reads fixture dependencies from the destructuring pattern; this has none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use({ kind: 'unselected' });
    },
    { auto: true },
  ],
});

function world(fixtures: StepFixtures): ScenarioWorld {
  if (fixtures.world === undefined) {
    throw new Error('stub steps need the scenario world');
  }
  return fixtures.world;
}

/**
 * The stub system: the barrier records a 200 response, or the status in
 * BLACKBOX_STUB_STATUS to stand for a system that changed between runs, and
 * the claim compares against it.
 */
const library = compilerTestLibrary([], {
  'the flow is sealed by the terminal response(s)': ({ fixtures }) => {
    world(fixtures).set('status', Number(process.env.BLACKBOX_STUB_STATUS ?? '200'));
    return Promise.resolve();
  },
  'the response status is {int}': ({ fixtures, parameters }) => {
    const actual = world(fixtures).get('status');
    if (actual !== parameters[0]) {
      throw new Error(`stub response status is ${String(actual)}, not ${String(parameters[0])}`);
    }
    return Promise.resolve();
  },
});

export const runStep = createStepRunner(library, test.step);
