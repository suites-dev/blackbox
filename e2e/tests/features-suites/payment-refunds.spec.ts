import { expect, test } from '@suites/blackbox-playwright';

import { payments as paymentMock } from '../../.blackbox/clients/payment-mock.js';

test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', { clients: { payments: paymentMock } }, (suite) => {
    suite.describe('Feature: Payment refunds', { tag: ['@sync'] }, () => {
      suite.beforeEach(
        'Background: The payment subsystem starts fresh',
        async ({ clients, step }) => {
          await step(
            'Given client "payments" has sent POST "/fixture/reset" with JSON and received 200:',
            async () => {
              const response = await clients.payments.post('/fixture/reset', { data: {} });
              expect(response.status()).toBe(200);
            },
          );
        },
      );

      suite.describe(
        'Rule: A refund must reference an existing payment',
        { tag: ['@validation'] },
        () => {
          suite.test(
            'Scenario: An unknown payment cannot be refunded',
            async ({ clients, step }) => {
              const response = await step(
                'When client "payments" sends POST "/v1/refunds" with JSON:',
                () =>
                  clients.payments.post('/v1/refunds', {
                    data: { paymentIntentId: 'pi_missing1' },
                  }),
              );
              await step('Then the response status is 404', () => {
                expect(response.status()).toBe(404);
              });
              await step('And the response JSON contains:', async () => {
                expect(await response.json()).toMatchObject({ code: 'payment-intent-not-found' });
              });
              await step(
                'But client "payments" GET "/fixture/state" returns 200 with JSON exactly:',
                async () => {
                  const state = await clients.payments.get('/fixture/state');
                  expect(state.status()).toBe(200);
                  expect(await state.json()).toEqual({ paymentIntents: [], refunds: [] });
                },
              );
            },
          );
        },
      );

      suite.describe('Rule: Each payment can be refunded only once', () => {
        suite.beforeEach('Background: Alice has a succeeded payment', async ({ clients, step }) => {
          await step(
            'Given client "payments" has sent POST "/v1/payment_intents" with JSON and received 201:',
            async () => {
              const response = await clients.payments.post('/v1/payment_intents', {
                data: { userId: 'alice', paymentMethodId: 'pm_alice_refundable' },
              });
              expect(response.status()).toBe(201);
            },
          );
        });

        suite.test(
          'Scenario: A repeated refund retains exactly one refund',
          async ({ clients, step }) => {
            const firstRefund = await step(
              'When client "payments" sends POST "/v1/refunds" with JSON:',
              () =>
                clients.payments.post('/v1/refunds', { data: { paymentIntentId: 'pi_alice1' } }),
            );
            await step('Then the response status is 201', () => {
              expect(firstRefund.status()).toBe(201);
            });
            await step('* the response JSON contains these fields:', async () => {
              expect(await firstRefund.json()).toMatchObject({
                id: 'refund_1',
                paymentIntentId: 'pi_alice1',
                status: 'succeeded',
              });
            });

            const repeatedRefund = await step(
              'When client "payments" sends POST "/v1/refunds" with JSON:',
              () =>
                clients.payments.post('/v1/refunds', { data: { paymentIntentId: 'pi_alice1' } }),
            );
            await step('Then the response status is 409', () => {
              expect(repeatedRefund.status()).toBe(409);
            });
            await step('And the response JSON contains:', async () => {
              expect(await repeatedRefund.json()).toMatchObject({ code: 'refund-already-exists' });
            });
            await step(
              'And client "payments" GET "/fixture/state" returns 200 with JSON exactly:',
              async () => {
                const state = await clients.payments.get('/fixture/state');
                expect(state.status()).toBe(200);
                expect(await state.json()).toEqual({
                  paymentIntents: [
                    {
                      id: 'pi_alice1',
                      paymentMethodId: 'pm_alice_refundable',
                      status: 'succeeded',
                      userId: 'alice',
                    },
                  ],
                  refunds: [{ id: 'refund_1', paymentIntentId: 'pi_alice1', status: 'succeeded' }],
                });
              },
            );
          },
        );
      });
    });
  });
});
