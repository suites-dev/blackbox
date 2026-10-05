import { expect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import { runtime, waitForReporter } from './runtime.fixture.js';

const test = createBlackboxTest(runtime);
test.use({
  catalogEntry: { kind: 'system', id: 'orders' },
  blackboxEnvironment: { TOKEN: 'synthetic-secret' },
});

test('business steps', async () => {
  console.log('native-test-output');
  console.error('native-test-error-output');
  await waitForReporter('native-stdout-observed');
  await test.step('Given an eligible customer', async () => {
    await test.step('When a subscription is requested', () => {
      expect(2 + 2).toBe(4);
    });
  });
});

test('retry isolation', ({ sandbox }, info) => {
  expect(sandbox.catalogEntry.id).toBe('orders');
  expect(info.retry).toBe(1);
});

test.describe('startup failure', () => {
  test.describe.configure({ retries: 0 });
  test.use({ catalogEntry: { kind: 'system', id: 'setup-failure' } });
  test('cannot enter the body', async () => {
    await test.info().attach('setup-body-entered', { body: 'entered' });
    throw new Error('BODY_MUST_NOT_EXECUTE');
  });
});

test.describe('cleanup failure', () => {
  test.describe.configure({ retries: 0 });
  test.use({ catalogEntry: { kind: 'system', id: 'cleanup-failure' } });
  test('retains cleanup failure', () => {
    expect(true).toBe(true);
  });
});
