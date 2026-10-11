import { expect, test as nativeTest } from '@playwright/test';

import { isTestBody } from '../../execution/body-phase.js';
import { createBlackboxSystemTest } from '../../fixtures.js';
import { joinParallelBarrier } from '../system-sandbox-harness/barrier-client.fixture.js';
import { record, systemSandboxRuntime } from '../system-sandbox/runtime.fixture.js';

interface InspectionFixtures {
  readonly inspection: string;
}
let joined = false;
const test = createBlackboxSystemTest(systemSandboxRuntime).extend<InspectionFixtures>({
  inspection: async ({ request, sandbox }, use, info) => {
    expect(isTestBody(info)).toBe(false);
    expect((await request.get('/fixture-setup')).ok()).toBe(true);
    record({ kind: 'phase-fixture-setup', executionId: sandbox.executionId });
    if (!joined && info.retry === 0) {
      joined = true;
      await joinParallelBarrier();
    }
    expect(isTestBody(info)).toBe(false);
    await use(sandbox.executionId);
    expect(isTestBody(info)).toBe(false);
    expect((await request.get('/fixture-teardown')).ok()).toBe(true);
    record({ kind: 'phase-fixture-teardown', executionId: sandbox.executionId });
  },
});

test.beforeAll(({ request: _request }, info) => {
  expect(isTestBody(info)).toBe(false);
});
test.afterAll(({ request: _request }, info) => {
  expect(isTestBody(info)).toBe(false);
});

test.system('orders', (system) => {
  system.sandbox('phase', (suite) => {
    suite.beforeEach(async ({ request }, info) => {
      expect(isTestBody(info)).toBe(false);
      await test.step('root step in setup', async () => {
        expect(isTestBody(info)).toBe(false);
        expect((await request.post('/hook-setup')).ok()).toBe(true);
      });
    });
    suite.afterEach(async ({ request }, info) => {
      expect(isTestBody(info)).toBe(false);
      expect((await request.post('/hook-teardown')).ok()).toBe(true);
    });
    suite.describe('nested', () => {
      suite.beforeEach(async ({ request }, info) => {
        expect(isTestBody(info)).toBe(false);
        expect((await request.post('/nested-hook')).ok()).toBe(true);
      });
      for (const title of ['parallel first', 'parallel second']) {
        suite.test(title, async ({ inspection, sandbox, step }, info) => {
          expect(inspection).toBe(sandbox.executionId);
          expect(isTestBody(info)).toBe(true);
          await test.step('root step', async () => {
            expect(isTestBody(info)).toBe(true);
            await suite.step('suite step', () => {
              expect(isTestBody(info)).toBe(true);
            });
            await nativeTest.step('native step', () => {
              expect(isTestBody(info)).toBe(true);
            });
            await step('fixture step', () => {
              expect(isTestBody(info)).toBe(true);
            });
          });
          record({ kind: 'phase-body', executionId: sandbox.executionId, retry: info.retry });
        });
      }
      suite.test('phase survives retry', ({ inspection, sandbox }, info) => {
        expect(inspection).toBe(sandbox.executionId);
        expect(isTestBody(info)).toBe(true);
        record({ kind: 'phase-retry', executionId: sandbox.executionId, retry: info.retry });
        expect(info.retry).toBe(1);
      });
    });
  });
});
