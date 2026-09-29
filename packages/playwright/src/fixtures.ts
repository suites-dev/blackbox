import { dirname, isAbsolute, resolve } from 'node:path';

import { test as playwrightTest, type TestInfo } from '@playwright/test';
import type { SandboxStopReason } from '@suites/blackbox-sandbox';

import {
  productionBlackboxRuntime,
  type BlackboxAttemptRuntime,
  type RunningBlackboxAttempt,
} from './runtime/acquisition.js';
import type { BlackboxTestFixtures, BlackboxTestOptions } from './types.js';

interface PrivateFixtures {
  readonly _blackboxAttempt: RunningBlackboxAttempt;
}

type BlackboxFixtures = BlackboxTestOptions & BlackboxTestFixtures & PrivateFixtures;

function configFilePath(declared: string, testInfo: TestInfo): string {
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

async function acquireWithinTestTimeout(input: {
  readonly runtime: BlackboxAttemptRuntime;
  readonly request: Parameters<BlackboxAttemptRuntime['start']>[0];
  readonly testInfo: TestInfo;
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
  let lateAttempt: RunningBlackboxAttempt;
  try {
    lateAttempt = await acquisition;
  } catch (cause) {
    throw new Error(timeoutError.message, { cause });
  }
  try {
    await lateAttempt.stop('failed');
  } catch (cleanupError) {
    throw new AggregateError(
      [timeoutError, cleanupError],
      'Blackbox sandbox acquisition timed out and cleanup failed',
    );
  }
  throw timeoutError;
}

export function createBlackboxTest(runtime: BlackboxAttemptRuntime) {
  return playwrightTest.extend<BlackboxFixtures>({
    catalogEntry: [{ kind: 'unselected' }, { option: true }],
    blackboxConfigFile: ['blackbox.config.yaml', { option: true }],
    blackboxEnvironment: [Object.freeze({}), { option: true }],
    _blackboxAttempt: [
      async ({ catalogEntry, blackboxConfigFile, blackboxEnvironment }, use, testInfo) => {
        const configuredTimeout = testInfo.timeout;
        const acquisitionStartedAt = Date.now();
        const attempt = await acquireWithinTestTimeout({
          runtime,
          testInfo,
          request: {
            selection: catalogEntry,
            configFile: configFilePath(blackboxConfigFile, testInfo),
            environment: blackboxEnvironment,
            artifactDirectory: testInfo.outputPath('blackbox'),
          },
        });
        if (configuredTimeout > 0) {
          testInfo.setTimeout(
            Math.max(1, configuredTimeout - (Date.now() - acquisitionStartedAt)),
          );
        }
        try {
          await use(attempt);
        } finally {
          await attempt.stop(stopReason(testInfo.status));
        }
      },
      // The helper enforces the test deadline and awaits cleanup if acquisition finishes late.
      { auto: true, timeout: 0 },
    ],
    sandbox: async ({ _blackboxAttempt }, use) => {
      await use(_blackboxAttempt.sandbox);
    },
    telemetry: async ({ _blackboxAttempt }, use) => {
      await use(_blackboxAttempt.telemetry);
    },
    baseURL: async ({ _blackboxAttempt }, use) => {
      await use(_blackboxAttempt.sandbox.entrypoint.url);
    },
  });
}

export const test = createBlackboxTest(productionBlackboxRuntime);
