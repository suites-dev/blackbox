import { expect, test } from '@suites/blackbox-playwright';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

test.use({
  catalogEntry: { kind: 'system', id: 'subscription-system' },
  blackboxConfigFile: requiredEnvironment('BLACKBOX_E2E_CONFIG_FILE'),
  blackboxEnvironment: {
    FIXTURE_CONTROL_TOKEN: requiredEnvironment('BLACKBOX_E2E_FIXTURE_TOKEN'),
  },
});

test('plain Playwright fixtures run in an automatic system sandbox', async ({ request }) => {
  const health = await request.get('/health');
  expect(health.ok()).toBe(true);

  const response = await request.post('/subscriptions', {
    data: { userId: 'alice', paymentMethodId: 'pm_playwright_alice' },
  });
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({
    userId: 'alice',
    subscription: { status: 'active' },
  });
});
