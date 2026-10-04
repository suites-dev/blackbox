import {
  test as playwrightTest,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
  type TestType,
} from '@playwright/test';

import { runAttemptFixture } from './fixture-lifecycle/attempt.js';
import type { BlackboxFixturePolicy } from './fixture-lifecycle/timeouts.js';
import {
  productionBlackboxRuntime,
  type BlackboxAttemptRuntime,
  type RunningBlackboxAttempt,
} from './runtime/acquisition.js';
import { createSystemTestFacade } from './system-test.js';
import type {
  BlackboxNativeTestArgs,
  BlackboxSandbox,
  BlackboxNativeWorkerArgs,
  BlackboxSystemTest,
  BlackboxTestFixtures,
  BlackboxTestOptions,
} from './types.js';

interface UnselectedAttemptFixture {
  readonly kind: 'unselected';
}

interface SelectedAttemptFixture {
  readonly kind: 'selected';
  readonly attempt: RunningBlackboxAttempt;
  readonly exec: BlackboxSandbox['exec'];
}

type AttemptFixture = UnselectedAttemptFixture | SelectedAttemptFixture;

interface PrivateFixtures {
  readonly _blackboxTestScope: undefined;
  readonly _blackboxAttempt: AttemptFixture;
}

type BlackboxFixtures = BlackboxTestOptions & BlackboxTestFixtures & PrivateFixtures;

type NativeBlackboxTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & BlackboxFixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

const defaultPolicy: BlackboxFixturePolicy = Object.freeze({
  sandboxCleanupTimeoutMs: 30_000,
});

function selectedAttempt(
  fixture: AttemptFixture,
  name: keyof BlackboxTestFixtures,
): SelectedAttemptFixture {
  if (fixture.kind === 'unselected') {
    throw new Error(
      `Blackbox fixture ${JSON.stringify(name)} is only available inside a test.system(...).sandbox(...) group`,
    );
  }
  return fixture;
}

export function createBlackboxTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = defaultPolicy,
): NativeBlackboxTest {
  const testScopes = new WeakSet<TestInfo>();
  return playwrightTest.extend<BlackboxFixtures>({
    catalogEntry: [{ kind: 'unselected' }, { option: true }],
    blackboxEnvironment: [Object.freeze({}), { option: true }],
    blackboxRetainAttempts: [false, { option: true }],
    _blackboxTestScope: [
      async ({ catalogEntry: _catalogEntry }, use, testInfo) => {
        testScopes.add(testInfo);
        try {
          await use(undefined);
        } finally {
          testScopes.delete(testInfo);
        }
      },
      { auto: true, timeout: 0 },
    ],
    _blackboxAttempt: [
      async ({ catalogEntry, blackboxEnvironment, blackboxRetainAttempts }, use, testInfo) => {
        if (catalogEntry.kind === 'unselected') {
          await use({ kind: 'unselected' });
          return;
        }
        if (!testScopes.has(testInfo)) {
          throw new Error(
            'Blackbox fixtures are only available in tests and beforeEach/afterEach, not beforeAll/afterAll. Each test owns its sandbox.',
          );
        }
        await runAttemptFixture({
          runtime,
          policy,
          testInfo,
          catalogEntry,
          blackboxEnvironment,
          blackboxRetainAttempts,
          use: async (attempt, exec) => {
            await use({ kind: 'selected', attempt, exec });
          },
        });
      },
      // The helper enforces the test deadline and bounds every sandbox cleanup wait.
      { auto: true, timeout: 0 },
    ],
    sandbox: async ({ _blackboxAttempt }, use) => {
      const { attempt, exec } = selectedAttempt(_blackboxAttempt, 'sandbox');
      await use(Object.freeze({ ...attempt.sandbox, exec }));
    },
    telemetry: async ({ _blackboxAttempt }, use) => {
      await use(selectedAttempt(_blackboxAttempt, 'telemetry').attempt.telemetry);
    },
    effects: async ({ _blackboxAttempt }, use) => {
      await use(selectedAttempt(_blackboxAttempt, 'effects').attempt.effects);
    },
  });
}

export function createBlackboxSystemTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = defaultPolicy,
): BlackboxSystemTest {
  return createSystemTestFacade<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs, PrivateFixtures>(
    createBlackboxTest(runtime, policy),
  );
}

export type { BlackboxFixturePolicy } from './fixture-lifecycle/timeouts.js';

export const test = createBlackboxSystemTest(productionBlackboxRuntime);
