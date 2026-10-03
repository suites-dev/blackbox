import { setTimeout as delay } from 'node:timers/promises';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxSystemTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';
import {
  record,
  startRespondingAttempt,
} from './runtime.fixture.js';

const nearHalfSetupRuntime = {
  async start(input) {
    await delay(300);
    return startRespondingAttempt(input);
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxSystemTest(nearHalfSetupRuntime);

test.system('timeout-budget', (system) => {
  system.sandbox('near-half setup', (suite) => {
    suite.describe.configure({ timeout: 600 });
    suite.test('keeps the native body timeout after acquisition', async ({ sandbox }) => {
      record({ kind: 'timeout-body-start', executionId: sandbox.executionId });
      await delay(425);
      record({ kind: 'timeout-body-end', executionId: sandbox.executionId });
      playwrightExpect(sandbox.catalogEntry.id).toBe('timeout-budget');
    });
  });
});
