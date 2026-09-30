import { expect, test } from '@suites/blackbox-playwright';

import { blackboxEnvironment, expectJson } from './support.js';

interface PaymentIntent {
  readonly id: string;
  readonly paymentMethodId: string;
  readonly status: 'succeeded';
  readonly userId: string;
}

interface Refund {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly status: 'succeeded';
}

test.use({
  catalogEntry: { kind: 'subsystem', id: 'payment-mock' },
  blackboxEnvironment,
});

test.describe('Rule: accepted payments produce one succeeded intent', () => {
  test('Scenario: a valid payment method creates a payment intent', async ({
    request,
    effects,
  }) => {
    const response = await test.step('When Alice submits a payment method', () =>
      request.post('/v1/payment_intents', {
        data: { paymentMethodId: 'pm_alice_primary', userId: 'alice' },
      }));

    await test.step('Then the completed response seals the accepted payment', async () => {
      expect(await expectJson<PaymentIntent>(response, 201)).toEqual({
        id: 'pi_alice1',
        paymentMethodId: 'pm_alice_primary',
        status: 'succeeded',
        userId: 'alice',
      });
    });

    await test.step('And the sealed execution contains one successful payment effect', async () => {
      await expect(effects).toSatisfy((e) => [
        e.exactly(
          1,
          e.http({
            actor: 'payment-mock',
            method: 'POST',
            outcome: 'success',
            route: '/v1/payment_intents',
          }),
        ),
      ]);
    });
  });
});

test.describe('Rule: each payment can be refunded at most once', () => {
  test('Scenario: a second refund for the same payment is rejected', async ({
    request,
    effects,
  }) => {
    await test.step('Given Alice has one succeeded payment', async () => {
      expect(
        (
          await request.post('/v1/payment_intents', {
            data: { paymentMethodId: 'pm_alice_refundable', userId: 'alice' },
          })
        ).status(),
      ).toBe(201);
    });

    const firstRefund = await test.step('When the payment is refunded', () =>
      request.post('/v1/refunds', { data: { paymentIntentId: 'pi_alice1' } }));
    const repeatedRefund = await test.step('And the same refund is requested again', () =>
      request.post('/v1/refunds', { data: { paymentIntentId: 'pi_alice1' } }));

    await test.step('Then both completed responses seal one success and one rejection', async () => {
      expect(await expectJson<Refund>(firstRefund, 201)).toEqual({
        id: 'refund_1',
        paymentIntentId: 'pi_alice1',
        status: 'succeeded',
      });
      expect(await expectJson(repeatedRefund, 409)).toMatchObject({
        code: 'refund-already-exists',
      });
    });

    await test.step('And the sealed execution contains exactly one successful refund', async () => {
      await expect(effects).toSatisfy((e) => [
        e.exactly(
          1,
          e.http({
            actor: 'payment-mock',
            method: 'POST',
            outcome: 'success',
            route: '/v1/refunds',
          }),
        ),
        e.exactly(
          1,
          e.http({
            actor: 'payment-mock',
            method: 'POST',
            outcome: 'failure',
            route: '/v1/refunds',
          }),
        ),
      ]);
    });
  });
});

test.describe('Rule: only known payments can be refunded', () => {
  test('Scenario: an unknown payment intent cannot be refunded', async ({ request, effects }) => {
    const response = await test.step('When a refund references an unknown payment', () =>
      request.post('/v1/refunds', { data: { paymentIntentId: 'pi_missing1' } }));

    await test.step('Then the completed response seals the rejection', async () => {
      expect(await expectJson(response, 404)).toMatchObject({
        code: 'payment-intent-not-found',
      });
    });

    await test.step('And the sealed execution contains no successful refund effect', async () => {
      await expect(effects).toSatisfy((e) => [
        e.absent(
          e.http({
            actor: 'payment-mock',
            method: 'POST',
            outcome: 'success',
            route: '/v1/refunds',
          }),
        ),
        e.exactly(
          1,
          e.http({
            actor: 'payment-mock',
            method: 'POST',
            outcome: 'failure',
            route: '/v1/refunds',
          }),
        ),
      ]);
    });
  });
});
