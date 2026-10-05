import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxSystemTest } from '../../fixtures.js';
import { record, systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxSystemTest(systemSandboxRuntime);

test.system('failure-cases', (system) => {
  system.sandbox('cleanup after failures', (suite) => {
    suite.beforeEach(({ sandbox }, testInfo) => {
      record({
        kind: 'failure-beforeEach',
        executionId: sandbox.executionId,
        title: testInfo.title,
      });
      if (testInfo.title === 'hook setup failure still cleans up') {
        throw new Error('synthetic beforeEach setup failure');
      }
    });

    suite.afterEach(({ sandbox }, testInfo) => {
      record({
        kind: 'failure-afterEach',
        executionId: sandbox.executionId,
        title: testInfo.title,
      });
    });

    suite.test('hook setup failure still cleans up', () => {
      record({ kind: 'forbidden-body' });
    });

    suite.test('body failure still cleans up', ({ sandbox }) => {
      record({ kind: 'failing-body', executionId: sandbox.executionId });
      playwrightExpect('actual').toBe('intentionally-wrong');
    });
  });
});
