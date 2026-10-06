import { expect, test } from '@playwright/test';

test('alpha', () => {
  expect(true).toBe(true);
});

// The test-timeout variant gives one test its own timeout, so the policy lists it.
test.describe(() => {
  if (process.env.BLACKBOX_TEST_POLICY_VARIANT === 'test-timeout') {
    test.describe.configure({ timeout: 60_000 });
  }

  test('beta', () => {
    expect(true).toBe(true);
  });
});
