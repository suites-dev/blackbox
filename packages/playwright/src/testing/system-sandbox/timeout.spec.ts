import { setTimeout as delay } from 'node:timers/promises';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';
import { record, startRespondingAttempt } from './runtime.fixture.js';

const nearHalfSetupRuntime = {
  async start(input) {
    await delay(300);
    return startRespondingAttempt(input);
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(nearHalfSetupRuntime);

test.describe('timeout-budget', () => {
  test.use({ blackbox: { system: { kind: 'system', id: 'timeout-budget' } } });
  test.describe('near-half setup', () => {
    test.describe.configure({ timeout: 600 });
    test('keeps the native body timeout after acquisition', async ({ sandbox }) => {
      record({ kind: 'timeout-body-start', executionId: sandbox.executionId });
      await delay(425);
      record({ kind: 'timeout-body-end', executionId: sandbox.executionId });
      playwrightExpect(sandbox.catalogEntry.id).toBe('timeout-budget');
    });
  });
});
