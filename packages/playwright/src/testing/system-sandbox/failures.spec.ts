import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import { record, systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxTest(systemSandboxRuntime);

test.describe('failure-cases', () => {
  test.use({ blackbox: { system: { kind: 'system', id: 'failure-cases' } } });
  test.describe('cleanup after failures', () => {
    test.beforeEach(({ sandbox }, testInfo) => {
      record({
        kind: 'failure-beforeEach',
        executionId: sandbox.executionId,
        title: testInfo.title,
      });
      if (testInfo.title === 'hook setup failure still cleans up') {
        throw new Error('synthetic beforeEach setup failure');
      }
    });

    test.afterEach(({ sandbox }, testInfo) => {
      record({
        kind: 'failure-afterEach',
        executionId: sandbox.executionId,
        title: testInfo.title,
      });
    });

    test('hook setup failure still cleans up', () => {
      record({ kind: 'forbidden-body' });
    });

    test('body failure still cleans up', ({ sandbox }) => {
      record({ kind: 'failing-body', executionId: sandbox.executionId });
      playwrightExpect('actual').toBe('intentionally-wrong');
    });
  });
});
