import { createAttemptStep } from './steps/step-context.js';
import { runClients } from './clients/clients.js';
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
  BlackboxStep,
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
  readonly clients: Readonly<Record<string, unknown>>;
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
): RunningBlackboxAttempt {
  if (fixture.kind === 'unselected') {
    throw new Error(
      `Blackbox fixture ${JSON.stringify(name)} is only available inside a test.system(...).sandbox(...) group`,
    );
  }
  return fixture.attempt;
}

function clientSetupTimeoutMs(testInfo: TestInfo, startedAt: number): number {
  return testInfo.timeout === 0
    ? Number.POSITIVE_INFINITY
    : Math.max(1, testInfo.timeout - (performance.now() - startedAt));
}

interface RunClientFixtureInput {
  readonly attempt: AttemptFixture;
  readonly blackboxClients: BlackboxFixtures['blackboxClients'];
  readonly use: (clients: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly testInfo: TestInfo;
  readonly testStartedAt: WeakMap<TestInfo, number>;
}

async function runClientFixture(input: RunClientFixtureInput): Promise<void> {
  if (input.attempt.kind === 'unselected') {
    await input.use(Object.freeze({}));
    return;
  }
  const startedAt = input.testStartedAt.get(input.testInfo);
  if (startedAt === undefined) {
    throw new Error('Blackbox client setup could not read the native test start time');
  }
  await runClients(input.blackboxClients ?? {}, input.attempt.attempt.sandbox, input.use, {
    cleanupTimeoutMs: 25_000,
    setupTimeoutMs: clientSetupTimeoutMs(input.testInfo, startedAt),
  });
}

async function stepFixture(
  { _blackboxAttempt }: Pick<PrivateFixtures, '_blackboxAttempt'>,
  use: (step: BlackboxStep) => Promise<void>,
): Promise<void> {
  const attempt = selectedAttempt(_blackboxAttempt, 'step');
  const fixture = createAttemptStep(playwrightTest.step.bind(playwrightTest), attempt);
  try {
    await use(fixture.step);
  } finally {
    fixture.revoke();
  }
}

export function createBlackboxTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = defaultPolicy,
): NativeBlackboxTest {
  const testScopes = new WeakSet<TestInfo>();
  const testStartedAt = new WeakMap<TestInfo, number>();
  return playwrightTest.extend<BlackboxFixtures>({
    catalogEntry: [{ kind: 'unselected' }, { option: true }],
    blackboxEnvironment: [Object.freeze({}), { option: true }],
    blackboxRetainAttempts: [false, { option: true }],
    blackboxClients: [{}, { option: true }],
    _blackboxTestScope: [
      async ({ catalogEntry: _catalogEntry }, use, testInfo) => {
        testScopes.add(testInfo);
        testStartedAt.set(testInfo, performance.now());
        try {
          await use(undefined);
        } finally {
          testScopes.delete(testInfo);
          testStartedAt.delete(testInfo);
        }
      },
      { auto: true, timeout: 0 },
    ],
    _blackboxAttempt: [
      async (
        { catalogEntry, blackboxEnvironment, blackboxRetainAttempts, blackboxClients },
        use,
        testInfo,
      ) => {
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
          blackboxClients,
          use: async (attempt) => {
            await use({ kind: 'selected', attempt });
          },
        });
      },
      // The helper enforces the test deadline and bounds every sandbox cleanup wait.
      { auto: true, timeout: 0 },
    ],
    clients: [
      async ({ _blackboxAttempt, blackboxClients }, use, testInfo) => {
        await runClientFixture({
          attempt: _blackboxAttempt,
          blackboxClients,
          use,
          testInfo,
          testStartedAt,
        });
      },
      // The explicit setup and cleanup budgets below must finish before Playwright tears down
      // the attempt fixture, even when the test's own deadline has expired.
      { auto: true, timeout: 0 },
    ],
    step: stepFixture,
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
  policy: BlackboxFixturePolicy = defaultPolicy,
): BlackboxSystemTest {
  return createSystemTestFacade<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs, PrivateFixtures>(
    createBlackboxTest(runtime, policy),
  );
}

export type { BlackboxFixturePolicy } from './fixture-lifecycle/timeouts.js';

export const test = createBlackboxSystemTest(productionBlackboxRuntime);
