import type { APIRequestContext } from '@playwright/test';

import { expect, test } from '@suites/blackbox-playwright';

import { blackboxEnvironment, expectJson } from './support.js';

interface SubscriptionResult {
  readonly userId: string;
  readonly tier: string;
  readonly subscription: { readonly id: string; readonly status: 'active' };
  readonly paymentIntentId: string | null;
  readonly orderId: string | null;
}

function subscribe(request: APIRequestContext, userId: string, paymentMethodId: string) {
  return request.post('/subscriptions', { data: { userId, paymentMethodId } });
}

test.use({
  catalogEntry: { kind: 'system', id: 'subscription-system' },
  blackboxEnvironment,
});

test.describe('Rule: an eligible user receives one complete subscription flow', () => {
  test('Scenario: Alice completes the full subscription flow', async ({ request, effects }) => {
    const response = await test.step('When Alice subscribes with a payment method', () =>
      subscribe(request, 'alice', 'pm_alice_primary'));

    await test.step('Then the completed response seals a successful subscription flow', async () => {
      expect(await expectJson<SubscriptionResult>(response, 201)).toEqual({
        orderId: 'order_alice',
        paymentIntentId: 'pi_alice1',
        subscription: { id: 'subscription_alice', status: 'active' },
        tier: 'pro',
        userId: 'alice',
      });
    });

    await test.step('And the sealed execution contains each business effect exactly once', async () => {
      await expect(effects).toSatisfy((e) => [
        e.exactly(
          1,
          e.http({
            actor: 'public-api',
            method: 'POST',
            outcome: 'success',
            route: '/assess',
          }),
        ),
        e.exactly(
          1,
          e.http({
            actor: 'public-api',
            method: 'POST',
            outcome: 'success',
            route: '/v1/payment_intents',
          }),
        ),
        e.exactly(
          1,
          e.http({
            actor: 'public-api',
            method: 'POST',
            outcome: 'success',
            route: '/orders',
          }),
        ),
        e.exactly(
          1,
          e.db({
            actor: 'public-api',
            operation: 'INSERT',
            outcome: 'success',
            table: 'subscriptions',
          }),
        ),
        e.exactly(
          1,
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
            outcome: 'success',
          }),
        ),
        e.before(
          e.http({ actor: 'public-api', method: 'POST', route: '/v1/payment_intents' }),
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
          }),
        ),
        e.before(
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
          }),
          e.db({ actor: 'public-api', operation: 'INSERT', table: 'subscriptions' }),
        ),
      ]);
    });
  });
});

test.describe('Rule: invalid subscription attempts have no side effects', () => {
  test('Scenario: an unknown user is rejected without calling downstream services', async ({
    request,
    effects,
  }) => {
    const response = await test.step('When an unknown user attempts to subscribe', () =>
      subscribe(request, 'ghost-user', 'pm_ghost'));

    await test.step('Then the completed response seals the rejection', async () => {
      expect(await expectJson(response, 404)).toEqual({
        outcome: 'unknown-user',
        userId: 'ghost-user',
      });
    });

    await test.step('And the sealed execution contains no subscription side effects', async () => {
      await expect(effects).toSatisfy((e) => [
        e.absent(e.http({ actor: 'public-api', method: 'POST', route: '/assess' })),
        e.absent(e.http({ actor: 'public-api', method: 'POST', route: '/v1/payment_intents' })),
        e.absent(e.http({ actor: 'public-api', method: 'POST', route: '/orders' })),
        e.absent(e.db({ actor: 'public-api', operation: 'INSERT', table: 'subscriptions' })),
        e.absent(
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
          }),
        ),
      ]);
    });
  });
});

test.describe('Rule: local-only subscriptions avoid external service effects', () => {
  test('Scenario: a local-only user activates without payment or ordering', async ({
    request,
    effects,
  }) => {
    const response = await test.step('When Dora subscribes with a payment method', () =>
      subscribe(request, 'dora', 'pm_dora_unused'));

    await test.step('Then the completed response seals a locally-created subscription', async () => {
      expect(await expectJson<SubscriptionResult>(response, 201)).toEqual({
        orderId: null,
        paymentIntentId: null,
        subscription: { id: 'subscription_dora', status: 'active' },
        tier: 'pro',
        userId: 'dora',
      });
    });

    await test.step('And the sealed execution stays on the local path', async () => {
      await expect(effects).toSatisfy((e) => [
        e.exactly(
          1,
          e.db({
            actor: 'public-api',
            operation: 'INSERT',
            outcome: 'success',
            table: 'subscriptions',
          }),
        ),
        e.atLeast(
          1,
          e.cache({
            actor: 'public-api',
            operation: 'SET',
            outcome: 'success',
          }),
        ),
        e.absent(e.http({ actor: 'public-api', method: 'POST', route: '/assess' })),
        e.absent(e.http({ actor: 'public-api', method: 'POST', route: '/v1/payment_intents' })),
        e.absent(e.http({ actor: 'public-api', method: 'POST', route: '/orders' })),
        e.absent(
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
          }),
        ),
      ]);
    });
  });
});

test.describe('Rule: a user can hold only one subscription', () => {
  test('Scenario: a repeated request does not repeat downstream effects', async ({
    request,
    effects,
  }) => {
    await test.step('Given Carol completed one subscription', async () => {
      expect((await subscribe(request, 'carol', 'pm_carol_primary')).status()).toBe(201);
    });

    const response = await test.step('When Carol submits another subscription request', () =>
      subscribe(request, 'carol', 'pm_carol_secondary'));

    await test.step('Then the completed response seals the duplicate rejection', async () => {
      expect(await expectJson(response, 409)).toEqual({
        outcome: 'duplicate-subscription',
        userId: 'carol',
      });
    });

    await test.step('And both requests produced only one downstream flow', async () => {
      await expect(effects).toSatisfy((e) => [
        e.exactly(1, e.http({ actor: 'public-api', method: 'POST', route: '/v1/payment_intents' })),
        e.exactly(1, e.http({ actor: 'public-api', method: 'POST', route: '/orders' })),
        e.exactly(1, e.db({ actor: 'public-api', operation: 'INSERT', table: 'subscriptions' })),
        e.exactly(
          1,
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
          }),
        ),
      ]);
    });
  });

  test('Scenario: concurrent requests create exactly one subscription flow', async ({
    request,
    effects,
  }) => {
    const responses = await test.step('When two subscription requests arrive together', () =>
      Promise.all([
        subscribe(request, 'bob', 'pm_bob_one'),
        subscribe(request, 'bob', 'pm_bob_two'),
      ]));

    await test.step('Then both completed responses seal one success and one rejection', () => {
      expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
    });

    await test.step('And concurrent arrival produced exactly one downstream flow', async () => {
      await expect(effects).toSatisfy((e) => [
        e.exactly(1, e.http({ actor: 'public-api', method: 'POST', route: '/assess' })),
        e.exactly(1, e.http({ actor: 'public-api', method: 'POST', route: '/v1/payment_intents' })),
        e.exactly(1, e.http({ actor: 'public-api', method: 'POST', route: '/orders' })),
        e.exactly(1, e.db({ actor: 'public-api', operation: 'INSERT', table: 'subscriptions' })),
        e.exactly(
          1,
          e.message({
            actor: 'order-service',
            destination: 'subscription-orders',
            operation: 'send',
          }),
        ),
      ]);
    });
  });
});
