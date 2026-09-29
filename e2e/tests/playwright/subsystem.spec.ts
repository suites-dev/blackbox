import { setTimeout as delay } from 'node:timers/promises';

import { expect, test, type BlackboxTelemetry } from '@suites/blackbox-playwright';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function observedTelemetry(telemetry: BlackboxTelemetry) {
  const deadline = Date.now() + 30_000;
  do {
    const observation = await telemetry.read();
    if (
      observation.kind === 'collector-session-found' &&
      observation.fragments.length > 0 &&
      observation.traceIds.length > 0
    ) {
      return observation;
    }
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error('Raw telemetry did not arrive within 30 seconds');
}

test.use({
  catalogEntry: { kind: 'subsystem', id: 'payment-mock' },
  blackboxConfigFile: requiredEnvironment('BLACKBOX_E2E_CONFIG_FILE'),
  blackboxEnvironment: {
    FIXTURE_CONTROL_TOKEN: requiredEnvironment('BLACKBOX_E2E_FIXTURE_TOKEN'),
  },
});

test('a retry receives a fresh subsystem sandbox and raw telemetry', async ({
  request,
  sandbox,
  telemetry,
}, testInfo) => {
  expect(sandbox.catalogEntry).toMatchObject({
    id: 'payment-mock',
    kind: 'subsystem',
    declaredIsolation: { kind: 'per-test' },
  });
  expect(telemetry.executionId).toBe(sandbox.executionId);
  expect((await telemetry.inspect()).kind).toBe('available');

  const response = await request.post('/v1/payment_intents', {
    data: { userId: 'alice', paymentMethodId: 'pm_playwright_alice' },
  });
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ id: 'pi_alice1', status: 'succeeded' });
  const observation = await observedTelemetry(telemetry);
  await testInfo.attach('blackbox-raw-telemetry', {
    body: Buffer.from(JSON.stringify(observation, null, 2)),
    contentType: 'application/json',
  });
  await testInfo.attach('blackbox-sandbox', {
    body: Buffer.from(JSON.stringify(sandbox, null, 2)),
    contentType: 'application/json',
  });

  expect(testInfo.retry).toBe(1);
});
