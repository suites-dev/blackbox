import { createStateRegistry, type createStimulusLifecycle, type StateRegistry } from './fixture-lifecycle/execution.js';
import { executionFixture } from './fixture-lifecycle/execution-fixture.js';
import { registerAssertionOwner } from './assertions/scope.js';
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
import { normalizeBlackboxOptions, registeredClients } from './config/normalization.js';
import type { BlackboxAttemptOptions } from './config/options.js';
import { requestFixtureFor } from './request/request-fixture.js';
import type {
  BlackboxStep,
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
  readonly _blackboxState: StateRegistry;
  readonly _blackboxExecution: ReturnType<typeof createStimulusLifecycle>;
  readonly _blackboxClients: Readonly<Record<string, unknown>>;
  readonly _blackboxOptions: BlackboxAttemptOptions;
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
      `Blackbox fixture ${JSON.stringify(name)} is only available when test.use({ blackbox: { system } }) selects a system`,
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
  readonly blackboxClients: BlackboxAttemptOptions['blackboxClients'];
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
  await runClients(input.blackboxClients, input.attempt.attempt.sandbox, input.use, {
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

async function stimulusFixture(
  { _blackboxExecution }: Pick<PrivateFixtures, '_blackboxExecution'>,
  use: (stimulus: BlackboxTestFixtures['stimulus']) => Promise<void>,
): Promise<void> {
  await use(_blackboxExecution.stimulus);
}

async function stateFixture(
  { _blackboxState }: Pick<PrivateFixtures, '_blackboxState'>,
  use: (state: BlackboxTestFixtures['state']) => Promise<void>,
): Promise<void> {
  await use(_blackboxState.state);
}

async function useSelectedAttempt(
  attempt: RunningBlackboxAttempt,
  testInfo: TestInfo,
  activeAttempts: WeakMap<TestInfo, RunningBlackboxAttempt>,
  use: (attempt: AttemptFixture) => Promise<void>,
): Promise<void> {
  activeAttempts.set(testInfo, attempt);
  try {
    await use({ kind: 'selected', attempt });
  } finally {
    activeAttempts.delete(testInfo);
  }
}

function testScopeFixture(testScopes: WeakSet<TestInfo>, testStartedAt: WeakMap<TestInfo, number>) {
  return async (
    { blackbox: _blackbox }: Pick<BlackboxTestOptions, 'blackbox'>,
    use: (value: undefined) => Promise<void>,
    testInfo: TestInfo,
  ): Promise<void> => {
    const releaseAssertions = registerAssertionOwner(testInfo);
    testScopes.add(testInfo);
    testStartedAt.set(testInfo, performance.now());
    try {
      await use(undefined);
    } finally {
      testScopes.delete(testInfo);
      testStartedAt.delete(testInfo);
      releaseAssertions();
    }
  };
}

export function createBlackboxTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = defaultPolicy,
): NativeBlackboxTest {
  const testScopes = new WeakSet<TestInfo>();
  const testStartedAt = new WeakMap<TestInfo, number>();
  const activeAttempts = new WeakMap<TestInfo, RunningBlackboxAttempt>();
  return playwrightTest.extend<BlackboxFixtures>({
    blackbox: [Object.freeze({}), { option: true }],
    _blackboxOptions: async ({ blackbox }, use) => {
      await use(normalizeBlackboxOptions(blackbox));
    },
    _blackboxTestScope: [testScopeFixture(testScopes, testStartedAt), { auto: true, timeout: 0 }],
    _blackboxAttempt: [
      async (
        { _blackboxOptions },
        use,
        testInfo,
      ) => {
        if (_blackboxOptions.catalogEntry.kind === 'unselected') {
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
          ..._blackboxOptions,
          use: (attempt) => useSelectedAttempt(attempt, testInfo, activeAttempts, use),
        });
      },
      // The helper enforces the test deadline and bounds every sandbox cleanup wait.
      { auto: true, timeout: 0 },
    ],
    _blackboxClients: [
      async ({ _blackboxAttempt, _blackboxOptions }, use, testInfo) => {
        await runClientFixture({
          attempt: _blackboxAttempt,
          blackboxClients: _blackboxOptions.blackboxClients,
          use,
          testInfo,
          testStartedAt,
        });
      },
      // The explicit setup and cleanup budgets below must finish before Playwright tears down
      // the attempt fixture, even when the test's own deadline has expired.
      { auto: true, timeout: 0 },
    ],
    _blackboxState: async ({ _blackboxAttempt }, use) => {
      selectedAttempt(_blackboxAttempt, 'state');
      const registry = createStateRegistry();
      try {
        await use(registry);
      } finally {
        registry.close();
      }
    },
    _blackboxExecution: executionFixture,
    stimulus: stimulusFixture,
    state: stateFixture,
    clients: async ({ _blackboxAttempt, _blackboxClients }, use) => {
      selectedAttempt(_blackboxAttempt, 'clients');
      await use(registeredClients(_blackboxClients));
    },
    request: requestFixtureFor(activeAttempts),
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

export type { BlackboxFixturePolicy } from './fixture-lifecycle/timeouts.js';

export const test = createBlackboxTest(productionBlackboxRuntime);
