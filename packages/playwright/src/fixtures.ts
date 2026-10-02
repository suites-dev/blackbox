import { dirname, isAbsolute, resolve } from 'node:path';

import { test as playwrightTest, type TestInfo } from '@playwright/test';
import type { SandboxStopReason } from '@suites/blackbox-sandbox';

import {
  productionBlackboxRuntime,
  type BlackboxAttemptRuntime,
  type RunningBlackboxAttempt,
} from './runtime/acquisition.js';
import {
  acquireWithinTestTimeout,
  defaultSandboxCleanupTimeoutMs,
  stopWithinCleanupTimeout,
  type BlackboxFixturePolicy,
} from './attempt/deadlines.js';
import type { BlackboxTestFixtures, BlackboxTestOptions } from './types.js';
import { AttemptReport } from './reporting/attempt.js';
import { reported } from './reporting/events.js';
import { reportObservations } from './reporting/observations.js';
import { retainAttempt, retainedAttemptDirectory } from './retention/retention.js';
import { createAttemptTraceContext, tracedHeaders } from './trace/trace-context.js';
import { spanQueries } from './telemetry/span-query.js';
import { suiteHook, testAttempt, type SuiteHookScope, type TestAttempt } from './suite-hooks.js';

interface PrivateFixtures {
  readonly _blackboxAttempt: TestAttempt | SuiteHookScope;
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

async function closeReport(
  report: AttemptReport,
  testInfo: TestInfo,
  retainAttempts: boolean,
): Promise<void> {
  const document = await report.finish();
  const sandboxId = report.owner();
  if (retainAttempts && sandboxId !== null) {
    await retainAttempt({
      directory: retainedAttemptDirectory(configFilePath(testInfo), sandboxId),
      recordDirectory: testInfo.outputPath('blackbox'),
      document,
    });
  }
}

const acquisitionStep = 'Blackbox: acquire sandbox';
const cleanupStep = 'Blackbox: clean up sandbox';

async function provideTestAttempt(input: {
  readonly runtime: BlackboxAttemptRuntime;
  readonly policy: BlackboxFixturePolicy;
  readonly options: BlackboxTestOptions;
  readonly testInfo: TestInfo;
  readonly use: (attempt: TestAttempt) => Promise<void>;
}): Promise<void> {
  const { options, policy, testInfo } = input;
  const report = new AttemptReport(testInfo);
  report.protect(options.blackboxEnvironment);
  try {
    // Steps put acquisition and cleanup time where Playwright reports durations; the
    // test's own duration excludes this fixture because it runs in its own time slot.
    const attempt = await playwrightTest.step(acquisitionStep, () =>
      acquireWithinTestTimeout({
        runtime: input.runtime,
        testInfo,
        cleanupTimeoutMs: policy.sandboxCleanupTimeoutMs,
        request: {
          selection: options.catalogEntry,
          configFile: configFilePath(testInfo),
          environment: options.blackboxEnvironment,
          artifactDirectory: testInfo.outputPath('blackbox'),
          progress: report,
        },
      }),
    );
    // The sandbox is owned from here on: every exit path below stops it.
    try {
      const trace = createAttemptTraceContext();
      report.acquired(attempt.sandbox, { ...attempt.telemetry, traceId: trace.traceId });
      report.emit(
        'sandbox',
        'completed',
        `${attempt.sandbox.sandboxId}; ${attempt.sandbox.entrypoint.url}`,
      );
      report.emit('trace', 'info', `request traceparent ${trace.traceparent}`);
      report.emit('execution', 'started', 'test fixtures, hooks and body');
      await report.flush();
      report.lifecycle('ready', attempt.sandbox.catalogEntry);
      await input.use(Object.freeze({ attempt, trace }));
    } finally {
      const reason = stopReason(testInfo.status);
      report.emit('execution', 'info', testInfo.status ?? 'unknown');
      await playwrightTest.step(cleanupStep, () => finishAttempt(attempt, report, reason, policy));
    }
  } catch (error) {
    report.emit('attempt', 'failed', 'setup or teardown failed; see test error');
    throw error;
  } finally {
    await closeReport(report, testInfo, options.blackboxRetainAttempts);
  }
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
    blackboxRetainAttempts: [false, { option: true }],
    _blackboxAttempt: [
      async ({ catalogEntry, blackboxEnvironment, blackboxRetainAttempts }, use, testInfo) => {
        const hook = suiteHook(testInfo);
        if (hook !== 'none') {
          await use({ suiteHook: hook });
          return;
        }
        await provideTestAttempt({
          runtime,
          policy,
          options: { catalogEntry, blackboxEnvironment, blackboxRetainAttempts },
          testInfo,
          use,
        });
      },
      // The helper enforces the test deadline and bounds every sandbox cleanup wait.
      // Setup never shortens the test timeout: Playwright applies testInfo.setTimeout()
      // to this fixture's own slot, which would time out before cleanup is owned.
      { auto: true, timeout: 0 },
    ],
    sandbox: async ({ _blackboxAttempt }, use) => {
      await use(testAttempt(_blackboxAttempt, 'sandbox').attempt.sandbox);
    },
    telemetry: async ({ _blackboxAttempt }, use) => {
      const { attempt, trace } = testAttempt(_blackboxAttempt, 'telemetry');
      await use(
        Object.freeze({ ...attempt.telemetry, ...trace, ...spanQueries(attempt.telemetry) }),
      );
    },
    effects: async ({ _blackboxAttempt }, use) => {
      await use(testAttempt(_blackboxAttempt, 'effects').attempt.effects);
    },
    // Suite hooks keep the configured baseURL; only a test attempt has a sandbox entrypoint.
    baseURL: async ({ _blackboxAttempt, baseURL }, use) => {
      await use(
        'suiteHook' in _blackboxAttempt ? baseURL : _blackboxAttempt.attempt.sandbox.entrypoint.url,
      );
    },
    // Only `request` joins the attempt trace. Browser pages are left alone: extra
    // headers on page traffic reach third-party origins and can trigger CORS preflights.
    request: async ({ playwright, extraHTTPHeaders, _blackboxAttempt }, use) => {
      const request = await playwright.request.newContext(
        'suiteHook' in _blackboxAttempt
          ? {}
          : { extraHTTPHeaders: tracedHeaders(extraHTTPHeaders, _blackboxAttempt.trace) },
      );
      await use(request);
      await request.dispose();
    },
  });
}

export const test = createBlackboxTest(productionBlackboxRuntime);
