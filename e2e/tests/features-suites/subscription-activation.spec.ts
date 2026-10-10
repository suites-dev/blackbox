import { expect, test } from '@suites/blackbox-playwright';

import { api as publicApi } from '../../.blackbox/clients/public-api.js';

// Hand-authored counterpart to subscription-activation.feature using the locked target API.
test.system('subscription-system', (system) => {
  system.sandbox('default', { clients: { api: publicApi } }, (suite) => {
    suite.describe('Feature: Subscription activation', { tag: ['@sync'] }, () => {
      suite.beforeEach(
        'Background: The subscription system starts fresh',
        async ({ clients, step }) => {
          await step(
            'Given client "api" has sent POST "/fixture/reset" with JSON and received 200:',
            async () => {
              const response = await clients.api.post('/fixture/reset', {
                data: { profile: 'fresh' },
              });
              expect(response.status()).toBe(200);
            },
          );
        },
      );

      suite.describe(
        'Rule: Full-path subscriptions settle their downstream state before returning',
        () => {
          suite.test(
            'Scenario: Alice activates a subscription through the full path',
            async ({ clients, step }) => {
              const response = await step(
                'When client "api" sends POST "/subscriptions" with JSON:',
                () =>
                  clients.api.post('/subscriptions', {
                    data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' },
                  }),
              );

              await step('Then the response status is 201', () => {
                expect(response.status()).toBe(201);
              });

              await step('And the response JSON contains these fields:', async () => {
                expect(await response.json()).toMatchObject({
                  userId: 'alice',
                  tier: 'pro',
                  subscription: { id: 'subscription_alice', status: 'active' },
                  paymentIntentId: 'pi_alice1',
                  orderId: 'order_alice',
                });
              });

              await step(
                'And client "api" GET "/fixture/state" returns 200 with JSON exactly:',
                async () => {
                  const state = await clients.api.get('/fixture/state');
                  expect(state.status()).toBe(200);
                  expect(await state.json()).toEqual({
                    fraudAudit: [
                      { decision: 'approved', hintProfile: 'long', id: '1', userId: 'alice' },
                    ],
                    payment: {
                      paymentIntents: [
                        {
                          id: 'pi_alice1',
                          paymentMethodId: 'pm_alice_primary',
                          status: 'succeeded',
                          userId: 'alice',
                        },
                      ],
                      refunds: [],
                    },
                    queueDepth: 1,
                    redis: { 'hint:long:alice': '1', 'user:alice:tier': 'pro' },
                    subscriptions: [
                      {
                        id: 'subscription_alice',
                        orderId: 'order_alice',
                        paymentIntentId: 'pi_alice1',
                        status: 'active',
                        tier: 'pro',
                        userId: 'alice',
                      },
                    ],
                  });
                },
              );
            },
          );
        },
      );

      suite.describe(
        'Rule: Local-only subscriptions retain no payment or order state',
        { tag: ['@local-only'] },
        () => {
          suite.describe('Scenario Outline: Activate local-only user <userId>', () => {
            const examples = [{ userId: 'dora' }, { userId: 'eve' }] as const;
            examples.forEach(({ userId }, row) => {
              suite.test(
                `Examples 1: Seeded local-only users / row ${row + 1}: Activate local-only user ${userId}`,
                async ({ clients, step }) => {
                  const response = await step(
                    'When client "api" sends POST "/subscriptions" with JSON:',
                    () =>
                      clients.api.post('/subscriptions', {
                        data: {
                          userId: userId,
                          paymentMethodId: `pm_${userId}_unused`,
                        },
                      }),
                  );
                  await step('Then the response status is 201', () => {
                    expect(response.status()).toBe(201);
                  });
                  await step('And the response JSON contains:', async () => {
                    expect(await response.json()).toMatchObject({
                      userId: userId,
                      tier: 'pro',
                      subscription: { id: `subscription_${userId}`, status: 'active' },
                      paymentIntentId: null,
                      orderId: null,
                    });
                  });
                  await step(
                    'And client "api" GET "/fixture/state" returns 200 with JSON exactly:',
                    async () => {
                      const state = await clients.api.get('/fixture/state');
                      expect(state.status()).toBe(200);
                      expect(await state.json()).toEqual({
                        fraudAudit: [],
                        payment: { paymentIntents: [], refunds: [] },
                        queueDepth: 0,
                        redis: {
                          [`reg:${userId}`]: '1',
                          [`user:${userId}:tier`]: 'pro',
                        },
                        subscriptions: [
                          {
                            id: `subscription_${userId}`,
                            orderId: null,
                            paymentIntentId: null,
                            status: 'active',
                            tier: 'pro',
                            userId: userId,
                          },
                        ],
                      });
                    },
                  );
                },
              );
            });
          });
        },
      );

      suite.describe(
        'Rule: Unknown users cannot create subscriptions',
        { tag: ['@validation'] },
        () => {
          suite.test(
            'Scenario: An unknown user leaves the system unchanged',
            async ({ clients, step }) => {
              const response = await step(
                'When client "api" sends POST "/subscriptions" with JSON:',
                () =>
                  clients.api.post('/subscriptions', {
                    data: { userId: 'ghost-user', paymentMethodId: 'pm_ghost' },
                  }),
              );
              await step('Then the response status is 404', () => {
                expect(response.status()).toBe(404);
              });
              await step('And the response JSON contains:', async () => {
                expect(await response.json()).toMatchObject({
                  outcome: 'unknown-user',
                  userId: 'ghost-user',
                });
              });
              await step(
                'But client "api" GET "/fixture/state" returns 200 with JSON exactly:',
                async () => {
                  const state = await clients.api.get('/fixture/state');
                  expect(state.status()).toBe(200);
                  expect(await state.json()).toEqual({
                    fraudAudit: [],
                    payment: { paymentIntents: [], refunds: [] },
                    queueDepth: 0,
                    redis: {},
                    subscriptions: [],
                  });
                },
              );
            },
          );
        },
      );

      suite.describe('Rule: A subscription can be created only once', () => {
        suite.beforeEach(
          'Background: Carol already has a subscription',
          async ({ clients, step }) => {
            await step(
              'Given client "api" has sent POST "/subscriptions" with JSON and received 201:',
              async () => {
                const response = await clients.api.post('/subscriptions', {
                  data: { userId: 'carol', paymentMethodId: 'pm_carol_primary' },
                });
                expect(response.status()).toBe(201);
              },
            );
          },
        );

        suite.test(
          'Scenario: A repeated request retains only the original downstream state',
          async ({ clients, step }) => {
            const response = await step(
              'When client "api" sends POST "/subscriptions" with JSON:',
              () =>
                clients.api.post('/subscriptions', {
                  data: { userId: 'carol', paymentMethodId: 'pm_carol_secondary' },
                }),
            );
            await step('Then the response status is 409', () => {
              expect(response.status()).toBe(409);
            });
            await step('And the response JSON contains:', async () => {
              expect(await response.json()).toMatchObject({
                outcome: 'duplicate-subscription',
                userId: 'carol',
              });
            });
            await step(
              'And client "api" GET "/fixture/state" returns 200 with JSON exactly:',
              async () => {
                const state = await clients.api.get('/fixture/state');
                expect(state.status()).toBe(200);
                expect(await state.json()).toEqual({
                  fraudAudit: [
                    { decision: 'approved', hintProfile: 'long', id: '1', userId: 'carol' },
                  ],
                  payment: {
                    paymentIntents: [
                      {
                        id: 'pi_carol1',
                        paymentMethodId: 'pm_carol_primary',
                        status: 'succeeded',
                        userId: 'carol',
                      },
                    ],
                    refunds: [],
                  },
                  queueDepth: 1,
                  redis: { 'hint:long:carol': '1', 'user:carol:tier': 'pro' },
                  subscriptions: [
                    {
                      id: 'subscription_carol',
                      orderId: 'order_carol',
                      paymentIntentId: 'pi_carol1',
                      status: 'active',
                      tier: 'pro',
                      userId: 'carol',
                    },
                  ],
                });
              },
            );
          },
        );
      });
    });
  });
});
