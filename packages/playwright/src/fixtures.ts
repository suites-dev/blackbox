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

export function createBlackboxTest(runtime: BlackboxAttemptRuntime) {
  return playwrightTest.extend<BlackboxFixtures>({
    catalogEntry: [{ kind: 'unselected' }, { option: true }],
    blackboxConfigFile: ['blackbox.config.yaml', { option: true }],
    blackboxEnvironment: [Object.freeze({}), { option: true }],
    _blackboxAttempt: [
      async ({ catalogEntry, blackboxConfigFile, blackboxEnvironment }, use, testInfo) => {
        const attempt = await runtime.start({
          selection: catalogEntry,
          configFile: configFilePath(blackboxConfigFile, testInfo),
          environment: blackboxEnvironment,
          artifactDirectory: testInfo.outputPath('blackbox'),
        });
        await use(attempt);
        await attempt.stop(stopReason(testInfo.status));
      },
      { auto: true },
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
