import { expect, test } from '@suites/blackbox-playwright';

import * as clients from '../../.blackbox/clients/payment-mock.js';
import {
  blackboxEnvironment,
  expectAttemptEvidenceIdentity,
  expectJson,
  readFixtureState,
} from './support.js';

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

interface PaymentState {
  readonly paymentIntents: readonly PaymentIntent[];
  readonly refunds: readonly Refund[];
}

const emptyPaymentState = { paymentIntents: [], refunds: [] } satisfies PaymentState;

test.system.sandbox(
  { kind: 'subsystem', id: 'payment-mock' },
  { environment: blackboxEnvironment, clients },
  (suite) => {
    suite.Feature('Payment service', ({ Rule }) => {
      Rule('accepted payments are retained as succeeded intents', ({ Scenario }) => {
        Scenario('a valid payment method creates a payment intent', async ({ Given }) => {
          await Given('the payment service has no prior transactions', async ({ clients, sandbox, telemetry, effects, When }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });
            expect(await readFixtureState<PaymentState>(clients.payments)).toEqual(emptyPaymentState);
            await When('Alice submits a payment method', async ({ request, sandbox, stimulus, Then, And, effects, clients }) => {
              const response = await stimulus(({ headers }) =>
                request.post(new URL('/v1/payment_intents', sandbox.entrypoint.url).href, {
                  data: { paymentMethodId: 'pm_alice_primary', userId: 'alice' },
                  headers,
                }),
              );
              await Then('a succeeded payment intent is returned and retained', async () => {
                const intent = {
                  id: 'pi_alice1',
                  paymentMethodId: 'pm_alice_primary',
                  status: 'succeeded',
                  userId: 'alice',
                } as const;
                expect(await expectJson<PaymentIntent>(response, 201)).toEqual(intent);
                expect(await readFixtureState<PaymentState>(clients.payments)).toEqual({
                  paymentIntents: [intent],
                  refunds: [],
                });
              });
              await And('the payment request is observed', async () => {
                await expect(effects).toSatisfy((e) => [
                  e.exists(e.http({ actor: 'payment-mock', method: 'POST' })),
                ]);
              });
            });
          });
        });
      });

      Rule('each payment can be refunded at most once', ({ Scenario }) => {
        Scenario('a second refund for the same payment is rejected', async ({ Given }) => {
          await Given('Alice has one succeeded payment', async ({ clients, request, sandbox, telemetry, effects, When }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });
            expect(await readFixtureState<PaymentState>(clients.payments)).toEqual(emptyPaymentState);
            expect(
              (
                await request.post(new URL('/v1/payment_intents', sandbox.entrypoint.url).href, {
                  data: { paymentMethodId: 'pm_alice_refundable', userId: 'alice' },
                })
              ).status(),
            ).toBe(201);
            await When('the payment is refunded', async ({ request, sandbox, stimulus, Then }) => {
              const firstRefund = await stimulus(({ headers }) =>
                request.post(new URL('/v1/refunds', sandbox.entrypoint.url).href, {
                  data: { paymentIntentId: 'pi_alice1' },
                  headers,
                }),
              );
              await Then('the first refund succeeds', async () => {
                expect(await expectJson<Refund>(firstRefund, 201)).toEqual({
                  id: 'refund_1',
                  paymentIntentId: 'pi_alice1',
                  status: 'succeeded',
                });
              });
            });
            await When('the same refund is requested again', async ({ request, sandbox, stimulus, Then, And, effects, clients }) => {
              const repeatedRefund = await stimulus(({ headers }) =>
                request.post(new URL('/v1/refunds', sandbox.entrypoint.url).href, {
                  data: { paymentIntentId: 'pi_alice1' },
                  headers,
                }),
              );
              await Then('the repeated refund is rejected', async () => {
                expect(await expectJson(repeatedRefund, 409)).toMatchObject({
                  code: 'refund-already-exists',
                });
              });
              await And('only one refund is retained', async () => {
                const state = await readFixtureState<PaymentState>(clients.payments);
                expect(state.paymentIntents).toHaveLength(1);
                expect(state.refunds).toEqual([
                  { id: 'refund_1', paymentIntentId: 'pi_alice1', status: 'succeeded' },
                ]);
              });
              await And('both refund requests are observed', async () => {
                await expect(effects).toSatisfy((e) => [
                  e.atLeast(2, e.http({ actor: 'payment-mock', method: 'POST' })),
                ]);
              });
            });
          });
        });
      });

      Rule('only known payments can be refunded', ({ Scenario }) => {
        Scenario('an unknown payment intent cannot be refunded', async ({ Given }) => {
          await Given('the payment service has no prior transactions', async ({ clients, sandbox, telemetry, effects, When }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });
            expect(await readFixtureState<PaymentState>(clients.payments)).toEqual(emptyPaymentState);
            await When('a refund references an unknown payment', async ({ request, sandbox, stimulus, Then, And, effects, clients }) => {
              const response = await stimulus(({ headers }) =>
                request.post(new URL('/v1/refunds', sandbox.entrypoint.url).href, {
                  data: { paymentIntentId: 'pi_missing1' },
                  headers,
                }),
              );
              await Then('the refund is rejected without recording a transaction', async () => {
                expect(await expectJson(response, 404)).toMatchObject({
                  code: 'payment-intent-not-found',
                });
                expect(await readFixtureState<PaymentState>(clients.payments)).toEqual(emptyPaymentState);
              });
              await And('the refund request is observed', async () => {
                await expect(effects).toSatisfy((e) => [
                  e.exists(e.http({ actor: 'payment-mock', method: 'POST' })),
                ]);
              });
            });
          });
        });
      });
    });
  },
);
