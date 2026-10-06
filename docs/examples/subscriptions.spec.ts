import { expect, test } from '@suites/blackbox-playwright';
import { fixtureEnvironment, readFixtureState } from './support.js';

test.system('subscription-system', (system) => {
  // This declares a configuration; every test attempt gets its own isolated Sandbox.
  system.sandbox('default', { environment: fixtureEnvironment() }, (suite) => {
    suite.test(
      'Alice receives one active subscription',
      { annotation: { type: 'requirement', description: 'REQ-101' } },
      async ({ request, sandbox }) => {
        await test.step('Given Alice has no subscription', async () => {
          expect((await readFixtureState(request, sandbox.entrypoint.url)).subscriptions).toHaveLength(0);
        });
        const response = await test.step('When Alice subscribes', () => request.post(
          new URL('/subscriptions', sandbox.entrypoint.url).href,
          { data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' }, maxRedirects: 0 },
        ));
        await test.step('Then one active subscription is retained for Alice', async () => {
          expect(response.status()).toBe(201);
          const { subscriptions } = await readFixtureState(request, sandbox.entrypoint.url);
          expect(subscriptions).toEqual([{ userId: 'alice', status: 'active' }]);
        });
      },
    );
  });
});
