import { expect, test } from '@suites/blackbox-playwright';

import { api as publicApi } from '../../.blackbox/clients/public-api.js';

import {
  blackboxEnvironment,
  expectAttemptEvidenceIdentity,
  expectJson,
  readFixtureState,
} from './support.js';
import { emptySystemState, type SystemState } from './subscription-state.js';

interface SubscriptionResult {
  readonly userId: string;
  readonly tier: string;
  readonly subscription: { readonly id: string; readonly status: 'active' };
  readonly paymentIntentId: string | null;
  readonly orderId: string | null;
}

test.system('subscription-system', (system) => {
  system.sandbox(
    'default',
    { environment: blackboxEnvironment, clients: { api: publicApi } },
    (suite) => {
      suite.describe('Rule: full-path subscriptions settle every required effect', () => {
        suite.test(
          'Scenario: an eligible user receives an active subscription',
          async ({ clients, sandbox, telemetry, effects, step }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

            await step('Given Alice has no subscription or downstream effects', async () => {
              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
            });

            const response = await step('When Alice subscribes with a payment method', () =>
              clients.api.post('/subscriptions', {
                data: { paymentMethodId: 'pm_alice_primary', userId: 'alice' },
              }),
            );

            await step(
              'Then the subscription is active only after every effect settles',
              async () => {
                expect(await expectJson<SubscriptionResult>(response, 201)).toEqual({
                  orderId: 'order_alice',
                  paymentIntentId: 'pi_alice1',
                  subscription: { id: 'subscription_alice', status: 'active' },
                  tier: 'pro',
                  userId: 'alice',
                });

                await step(
                  'And the durable state records one coherent subscription flow',
                  async () => {
                    expect(await readFixtureState<SystemState>(clients.api)).toEqual({
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
      });

      suite.describe('Rule: invalid subscription attempts have no side effects', () => {
        suite.test(
          'Scenario: an unknown user is rejected without side effects',
          async ({ clients, sandbox, telemetry, effects, step }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

            await step('Given the system has no prior subscription activity', async () => {
              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
            });

            const response = await step('When an unknown user attempts to subscribe', () =>
              clients.api.post('/subscriptions', {
                data: { paymentMethodId: 'pm_ghost', userId: 'ghost-user' },
              }),
            );

            await step(
              'Then the request is rejected and the system remains unchanged',
              async () => {
                expect(await expectJson(response, 404)).toEqual({
                  outcome: 'unknown-user',
                  userId: 'ghost-user',
                });
                expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
              },
            );
          },
        );
      });

      suite.describe('Rule: local-only subscriptions avoid external service effects', () => {
        suite.test(
          'Scenario: a local-only user activates without payment or ordering',
          async ({ clients, sandbox, telemetry, effects, step }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

            await step('Given Dora has no subscription or downstream effects', async () => {
              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
            });

            const response = await step('When Dora subscribes with a payment method', () =>
              clients.api.post('/subscriptions', {
                data: { paymentMethodId: 'pm_dora_unused', userId: 'dora' },
              }),
            );

            await step(
              'Then her subscription is activated entirely within the local path',
              async () => {
                expect(await expectJson<SubscriptionResult>(response, 201)).toEqual({
                  orderId: null,
                  paymentIntentId: null,
                  subscription: { id: 'subscription_dora', status: 'active' },
                  tier: 'pro',
                  userId: 'dora',
                });
                expect(await readFixtureState<SystemState>(clients.api)).toEqual({
                  fraudAudit: [],
                  payment: { paymentIntents: [], refunds: [] },
                  queueDepth: 0,
                  redis: { 'reg:dora': '1', 'user:dora:tier': 'pro' },
                  subscriptions: [
                    {
                      id: 'subscription_dora',
                      orderId: null,
                      paymentIntentId: null,
                      status: 'active',
                      tier: 'pro',
                      userId: 'dora',
                    },
                  ],
                });
              },
            );
          },
        );
      });

      suite.describe('Rule: a user can hold only one subscription', () => {
        suite.test(
          'Scenario: a repeated request does not repeat downstream effects',
          async ({ clients, sandbox, telemetry, effects, step }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

            await step('Given Carol already completed one subscription', async () => {
              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
              expect(
                (
                  await clients.api.post('/subscriptions', {
                    data: { paymentMethodId: 'pm_carol_primary', userId: 'carol' },
                  })
                ).status(),
              ).toBe(201);
            });

            const response = await step('When Carol submits another subscription request', () =>
              clients.api.post('/subscriptions', {
                data: { paymentMethodId: 'pm_carol_secondary', userId: 'carol' },
              }),
            );

            await step(
              'Then the duplicate is rejected without another downstream flow',
              async () => {
                expect(await expectJson(response, 409)).toEqual({
                  outcome: 'duplicate-subscription',
                  userId: 'carol',
                });
                const state = await readFixtureState<SystemState>(clients.api);
                expect(state.subscriptions).toHaveLength(1);
                expect(state.fraudAudit).toHaveLength(1);
                expect(state.payment.paymentIntents).toEqual([
                  {
                    id: 'pi_carol1',
                    paymentMethodId: 'pm_carol_primary',
                    status: 'succeeded',
                    userId: 'carol',
                  },
                ]);
                expect(state.queueDepth).toBe(1);
              },
            );
          },
        );

        suite.test(
          'Scenario: concurrent requests create exactly one subscription',
          async ({ clients, sandbox, telemetry, effects, step }) => {
            expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

            await step('Given Bob has no subscription or downstream effects', async () => {
              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
            });

            const responses = await step('When two subscription requests arrive together', () =>
              Promise.all([
                clients.api.post('/subscriptions', {
                  data: { paymentMethodId: 'pm_bob_one', userId: 'bob' },
                }),
                clients.api.post('/subscriptions', {
                  data: { paymentMethodId: 'pm_bob_two', userId: 'bob' },
                }),
              ]),
            );

            await step(
              'Then exactly one request wins and one complete flow is recorded',
              async () => {
                expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
                const duplicate = responses.find((response) => response.status() === 409);
                if (duplicate === undefined) {
                  throw new Error('Expected one duplicate response');
                }
                expect(await duplicate.json()).toEqual({
                  outcome: 'duplicate-subscription',
                  userId: 'bob',
                });

                await step('And concurrent arrival does not duplicate any effect', async () => {
                  const state = await readFixtureState<SystemState>(clients.api);
                  expect(state.subscriptions).toEqual([
                    {
                      id: 'subscription_bob',
                      orderId: 'order_bob',
                      paymentIntentId: 'pi_bob1',
                      status: 'active',
                      tier: 'pro',
                      userId: 'bob',
                    },
                  ]);
                  expect(state.fraudAudit).toEqual([
                    { decision: 'approved', hintProfile: 'short', id: '1', userId: 'bob' },
                  ]);
                  expect(state.payment.paymentIntents).toHaveLength(1);
                  const intent = state.payment.paymentIntents.at(0);
                  if (intent === undefined) {
                    throw new Error('Expected one payment intent');
                  }
                  expect(intent).toMatchObject({
                    id: 'pi_bob1',
                    status: 'succeeded',
                    userId: 'bob',
                  });
                  expect(['pm_bob_one', 'pm_bob_two']).toContain(intent.paymentMethodId);
                  expect(state.queueDepth).toBe(1);
                });
              },
            );
          },
        );
      });
    },
  );
});
