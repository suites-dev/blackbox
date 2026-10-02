import { dirname, isAbsolute, resolve } from 'node:path';

import { test as playwrightTest, type TestInfo } from '@playwright/test';
import type { SandboxStopReason } from '@suites/blackbox-sandbox';

import {
  productionBlackboxRuntime,
  type BlackboxAttemptRuntime,
  type RunningBlackboxAttempt,
} from './runtime/acquisition.js';
import type { BlackboxTestFixtures, BlackboxTestOptions } from './types.js';
import { AttemptReport } from './reporting/attempt.js';
import { reported } from './reporting/events.js';
import { reportObservations } from './reporting/observations.js';
import { suiteHook, testAttempt, type SuiteHookScope } from './suite-hooks.js';

interface PrivateFixtures {
  readonly _blackboxAttempt: RunningBlackboxAttempt | SuiteHookScope;
}

type BlackboxFixtures = BlackboxTestOptions & BlackboxTestFixtures & PrivateFixtures;

function configFilePath(testInfo: TestInfo): string {
  const declared: unknown = testInfo.config.metadata.blackboxConfigFile;
  if (typeof declared !== 'string' || declared.trim().length === 0) {
    throw new Error(
      'Set blackboxConfigFile using defineConfig from @suites/blackbox-playwright/config',
    );
  }
  if (isAbsolute(declared)) {
    return declared;
  }
  const playwrightConfig = testInfo.config.configFile;
  const root =
    playwrightConfig === undefined || playwrightConfig.length === 0
      ? process.cwd()
      : dirname(playwrightConfig);
  return resolve(root, declared);
}

function stopReason(status: TestInfo['status']): SandboxStopReason {
  switch (status) {
    case 'passed':
      return 'completed';
    case 'skipped':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
    case 'timedOut':
    case undefined:
      return 'failed';
  }
}

const acquisitionTimedOut = Symbol('acquisitionTimedOut');

const defaultSandboxCleanupTimeoutMs = 30_000;

const cleanupCompleted = Symbol('cleanupCompleted');
const cleanupTimedOut = Symbol('cleanupTimedOut');

interface BlackboxFixturePolicy {
  /** Maximum time to wait for any sandbox cleanup operation. */
  readonly sandboxCleanupTimeoutMs: number;
}

async function cleanupSettledWithin(cleanup: Promise<void>, timeoutMs: number): Promise<boolean> {
  // If the bounded wait expires, retain a rejection handler without awaiting
  // this continuation in fixture teardown.
  void cleanup.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof cleanupTimedOut>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(cleanupTimedOut);
    }, timeoutMs);
  });
  const outcome = await Promise.race([cleanup.then(() => cleanupCompleted), deadline]).finally(
    () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  );
  return outcome === cleanupCompleted;
}

async function awaitLateAcquisitionCleanup(input: {
  readonly acquisition: Promise<RunningBlackboxAttempt>;
  readonly timeoutError: Error;
  readonly cleanupTimeoutMs: number;
}): Promise<never> {
  const cleanup = input.acquisition.then(
    async (attempt) => {
      try {
        await attempt.stop('failed');
      } catch (cleanupError) {
        throw new AggregateError(
          [input.timeoutError, cleanupError],
          'Blackbox sandbox acquisition timed out and cleanup failed',
        );
      }
    },
    (cause: unknown) => {
      throw new Error(input.timeoutError.message, { cause });
    },
  );
  if (!(await cleanupSettledWithin(cleanup, input.cleanupTimeoutMs))) {
    throw new AggregateError(
      [input.timeoutError],
      `Blackbox sandbox acquisition cleanup did not settle within ${input.cleanupTimeoutMs}ms`,
    );
  }
  throw input.timeoutError;
}

async function stopWithinCleanupTimeout(input: {
  readonly attempt: RunningBlackboxAttempt;
  readonly reason: SandboxStopReason;
  readonly cleanupTimeoutMs: number;
}): Promise<void> {
  if (!(await cleanupSettledWithin(input.attempt.stop(input.reason), input.cleanupTimeoutMs))) {
    throw new Error(
      `Blackbox sandbox cleanup did not settle within ${input.cleanupTimeoutMs}ms after ${input.reason}`,
    );
  }
}

async function acquireWithinTestTimeout(input: {
  readonly runtime: BlackboxAttemptRuntime;
  readonly request: Parameters<BlackboxAttemptRuntime['start']>[0];
  readonly testInfo: TestInfo;
  readonly cleanupTimeoutMs: number;
}): Promise<RunningBlackboxAttempt> {
  const acquisition = input.runtime.start(input.request);
  if (input.testInfo.timeout === 0) {
    return acquisition;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof acquisitionTimedOut>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(acquisitionTimedOut);
    }, input.testInfo.timeout);
  });
  const outcome = await Promise.race([acquisition, deadline]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
  if (outcome !== acquisitionTimedOut) {
    return outcome;
  }

  const timeoutError = new Error(
    `Blackbox sandbox acquisition exceeded the Playwright test timeout of ${input.testInfo.timeout}ms`,
  );
  return awaitLateAcquisitionCleanup({
    acquisition,
    timeoutError,
    cleanupTimeoutMs: input.cleanupTimeoutMs,
  });
}

async function finishAttempt(
  attempt: RunningBlackboxAttempt,
  report: AttemptReport,
  reason: SandboxStopReason,
  policy: BlackboxFixturePolicy,
): Promise<void> {
  try {
    await reported(report, 'teardown', `reason=${reason}; cleanup owned resources`, () =>
      stopWithinCleanupTimeout({
        attempt,
        reason,
        cleanupTimeoutMs: policy.sandboxCleanupTimeoutMs,
      }),
    );
  } catch (error) {
    report.lifecycle('cleanup failed', attempt.sandbox.catalogEntry);
    throw error;
  }
  report.lifecycle('cleaned up', attempt.sandbox.catalogEntry);
  await reportObservations(report, attempt);
}

export function createBlackboxTest(
  runtime: BlackboxAttemptRuntime,
  policy: BlackboxFixturePolicy = {
    sandboxCleanupTimeoutMs: defaultSandboxCleanupTimeoutMs,
  },
) {
  return playwrightTest.extend<BlackboxFixtures>({
    catalogEntry: [{ kind: 'unselected' }, { option: true }],
    blackboxEnvironment: [Object.freeze({}), { option: true }],
    _blackboxAttempt: [
      async ({ catalogEntry, blackboxEnvironment }, use, testInfo) => {
        const hook = suiteHook(testInfo);
        if (hook !== 'none') {
          await use({ suiteHook: hook });
          return;
        }
        const report = new AttemptReport(testInfo);
        report.protect(blackboxEnvironment);
        try {
          const attempt = await acquireWithinTestTimeout({
            runtime,
            testInfo,
            cleanupTimeoutMs: policy.sandboxCleanupTimeoutMs,
            request: {
              selection: catalogEntry,
              configFile: configFilePath(testInfo),
              environment: blackboxEnvironment,
              artifactDirectory: testInfo.outputPath('blackbox'),
              progress: report,
            },
          });
          // The sandbox is owned from here on: every exit path below stops it.
          try {
            report.acquired(attempt.sandbox, attempt.telemetry);
            report.emit(
              'sandbox',
              'completed',
              `${attempt.sandbox.sandboxId}; ${attempt.sandbox.entrypoint.url}`,
            );
            report.emit('execution', 'started', 'test fixtures, hooks and body');
            await report.flush();
            report.lifecycle('ready', attempt.sandbox.catalogEntry);
            await use(attempt);
          } finally {
            const reason = stopReason(testInfo.status);
            report.emit('execution', 'info', testInfo.status ?? 'unknown');
            await finishAttempt(attempt, report, reason, policy);
          }
        } catch (error) {
          report.emit('attempt', 'failed', 'setup or teardown failed; see test error');
          throw error;
        } finally {
          await report.finish();
        }
      },
      // The helper enforces the test deadline and bounds every sandbox cleanup wait.
      // Setup never shortens the test timeout: Playwright applies testInfo.setTimeout()
      // to this fixture's own slot, which would time out before cleanup is owned.
      { auto: true, timeout: 0 },
    ],
    sandbox: async ({ _blackboxAttempt }, use) => {
      await use(testAttempt(_blackboxAttempt, 'sandbox').sandbox);
    },
    telemetry: async ({ _blackboxAttempt }, use) => {
      await use(testAttempt(_blackboxAttempt, 'telemetry').telemetry);
    },
    effects: async ({ _blackboxAttempt }, use) => {
      await use(testAttempt(_blackboxAttempt, 'effects').effects);
    },
    // Suite hooks keep the configured baseURL; only a test attempt has a sandbox entrypoint.
    baseURL: async ({ _blackboxAttempt, baseURL }, use) => {
      await use(
        'suiteHook' in _blackboxAttempt ? baseURL : _blackboxAttempt.sandbox.entrypoint.url,
      );
    },
  });
}

export const test = createBlackboxTest(productionBlackboxRuntime);
