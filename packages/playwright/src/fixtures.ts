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
import { defaultFixturePolicy, type BlackboxFixturePolicy } from './fixture-lifecycle/timeouts.js';
import {
  productionBlackboxRuntime,
  type BlackboxAttemptRuntime,
  type RunningBlackboxAttempt,
} from './runtime/acquisition.js';
import { createSystemTestFacade } from './system-test.js';
import type {
  BlackboxNativeTestArgs,
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

function selectedAttempt(
  fixture: AttemptFixture,
  name: keyof BlackboxTestFixtures,
): RunningBlackboxAttempt {
  if (fixture.kind === 'unselected') {
    throw new Error(
      `Blackbox fixture ${JSON.stringify(name)} is only available inside a test.system(...).sandbox(...) group`,
    );
  }
  return fixture.attempt;
}

export function createBlackboxTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = defaultFixturePolicy,
): NativeBlackboxTest {
  const testScopes = new WeakSet<TestInfo>();
  return playwrightTest.extend<BlackboxFixtures>({
    catalogEntry: [{ kind: 'unselected' }, { option: true }],
    blackboxEnvironment: [Object.freeze({}), { option: true }],
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
      async ({ catalogEntry, blackboxEnvironment }, use, testInfo) => {
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
          use: async (attempt) => {
            await use({ kind: 'selected', attempt });
          },
        });
      },
      // The helper enforces the test deadline and bounds every sandbox cleanup wait.
      { auto: true, timeout: 0 },
    ],
    sandbox: async ({ _blackboxAttempt }, use) => {
      await use(selectedAttempt(_blackboxAttempt, 'sandbox').sandbox);
    },
    telemetry: async ({ _blackboxAttempt }, use) => {
      await use(selectedAttempt(_blackboxAttempt, 'telemetry').telemetry);
    },
    effects: async ({ _blackboxAttempt }, use) => {
      await use(selectedAttempt(_blackboxAttempt, 'effects').effects);
    },
  });
}

export function createBlackboxSystemTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = defaultFixturePolicy,
): BlackboxSystemTest {
  return createSystemTestFacade<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs, PrivateFixtures>(
    createBlackboxTest(runtime, policy),
  );
}

export type { BlackboxFixturePolicy } from './fixture-lifecycle/timeouts.js';

export const test = createBlackboxSystemTest(productionBlackboxRuntime);
