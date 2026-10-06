import { library } from '../../library/index.js';
import { sandboxAt } from '../../library/testing/step-harness.js';
import { createStepRunner } from '../../runtime/run-step.js';
import { test as scenarioTest } from '../../runtime/scenario-test.js';

// The generated-code runtime for a real Playwright run of the shared step
// library without Docker. Like playwright-runtime.ts, the facade's Sandbox
// acquisition fixture yields no attempt; here the `sandbox` fixture is a
// loopback system at BLACKBOX_LOOPBACK_URL instead. Every step resolves
// against the shared library and runs its own body. With
// BLACKBOX_LOOPBACK_EXPECT_FAILURE=1 every test is marked as expected to fail,
// as a patched runtime could mark it, for the rule-dodging verdict tests.

export { sandboxCredentials } from '../../runtime/credentials.js';
export { sandboxEnvironment } from '../../runtime/environment.js';

export const test = scenarioTest.extend<{
  readonly _blackboxAttempt: { readonly kind: 'unselected' };
  readonly _expectedToFail: undefined;
}>({
  _blackboxAttempt: [
    // Playwright reads fixture dependencies from the destructuring pattern; this has none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use({ kind: 'unselected' });
    },
    { auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern
  sandbox: async ({}, use) => {
    const url = process.env.BLACKBOX_LOOPBACK_URL;
    if (url === undefined) {
      throw new Error('BLACKBOX_LOOPBACK_URL must name the loopback system the steps address');
    }
    await use(sandboxAt(url));
  },
  _expectedToFail: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      if (process.env.BLACKBOX_LOOPBACK_EXPECT_FAILURE === '1') {
        testInfo.fail();
      }
      await use(undefined);
    },
    { auto: true },
  ],
});

export const runStep = createStepRunner(library, test.step);
