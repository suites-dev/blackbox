import { expect, test, type RegisteredClients } from '@suites/blackbox-playwright';

import * as clients from '../../.blackbox/clients/index.js';
import { expectClientSandboxEndpoints, expectPersistedSubscription } from './persisted-state.js';

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

async function expectAliceDurableState(
  registered: RegisteredClients<typeof clients>,
): Promise<void> {
  await expectPersistedSubscription(registered, {
    id: 'subscription_alice',
    userId: 'alice',
    tier: 'pro',
    status: 'active',
    paymentIntentId: 'pi_alice1',
    orderId: 'order_alice',
  });
  expect(await readFixtureState<SystemState>(registered.api)).toEqual({
    fraudAudit: [{ decision: 'approved', hintProfile: 'long', id: '1', userId: 'alice' }],
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
}

async function expectBobDurableState(registered: RegisteredClients<typeof clients>): Promise<void> {
  const state = await readFixtureState<SystemState>(registered.api);
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
}

test.system.sandbox(
  'subscription-system',
  { environment: blackboxEnvironment, clients },
  (suite) => {
    suite.Feature('Subscription activation', ({ Background, Rule }) => {
      Background('Client endpoints belong to the current sandbox', ({ Given }) => {
        Given('the registered clients address the current sandbox', ({ clients, sandbox }) => {
          expectClientSandboxEndpoints(clients, sandbox);
        });
      });
      Rule('full-path subscriptions settle every required effect', ({ Scenario }) => {
        Scenario('an eligible user receives an active subscription', ({ Given }) =>
          Given(
            'Alice has no subscription or downstream effects',
            async ({ clients, request, sandbox, telemetry, effects, When }) => {
              expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
              expect(await clients.redis.get('user:alice:tier')).toBeNull();
              expect((await clients.postgres.query('SELECT * FROM subscriptions')).rows).toEqual(
                [],
              );

              await When(
                'Alice subscribes with a payment method',
                async ({ stimulus, Then, And }) => {
                  const response = await stimulus(({ headers }) =>
                    request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                      data: { paymentMethodId: 'pm_alice_primary', userId: 'alice' },
                      headers,
                    }),
                  );

                  await Then(
                    'the subscription is active only after every effect settles',
                    async () => {
                      expect(await expectJson<SubscriptionResult>(response, 201)).toEqual({
                        orderId: 'order_alice',
                        paymentIntentId: 'pi_alice1',
                        subscription: { id: 'subscription_alice', status: 'active' },
                        tier: 'pro',
                        userId: 'alice',
                      });
                    },
                  );
                  await And('the required effects are observed', async () => {
                    await expect(effects).toSatisfy((e) => [
                      e.exists(e.http({ actor: 'public-api', method: 'POST' })),
                      e.exists(e.http({ actor: 'fraud-check', method: 'POST' })),
                      e.exists(e.http({ actor: 'payment-mock', method: 'POST' })),
                      e.exists(e.http({ actor: 'order-service', method: 'POST' })),
                      e.exists(e.db({ actor: 'fraud-check' })),
                      e.exists(e.cache({ actor: 'public-api', operation: 'SET' })),
                      e.exists(
                        e.rpc({ actor: 'order-service', operation: 'SendMessage', service: 'SQS' }),
                      ),
                    ]);
                  });
                  await And(
                    'the durable state records one coherent subscription flow',
                    async () => {
                      await expectAliceDurableState(clients);
                    },
                  );
                },
              );
            },
          ),
        );
      });
      Rule('invalid subscription attempts have no side effects', ({ Scenario }) => {
        Scenario('an unknown user is rejected without side effects', ({ Given }) =>
          Given(
            'the system has no prior subscription activity',
            async ({ clients, request, sandbox, telemetry, effects, When }) => {
              expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);

              await When(
                'an unknown user attempts to subscribe',
                async ({ stimulus, Then, And }) => {
                  const response = await stimulus(({ headers }) =>
                    request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                      data: { paymentMethodId: 'pm_ghost', userId: 'ghost-user' },
                      headers,
                    }),
                  );

                  await Then(
                    'the request is rejected and the system remains unchanged',
                    async () => {
                      expect(await expectJson(response, 404)).toEqual({
                        outcome: 'unknown-user',
                        userId: 'ghost-user',
                      });
                      expect(await readFixtureState<SystemState>(clients.api)).toEqual(
                        emptySystemState,
                      );
                    },
                  );
                  await And('the required effects are observed', async () => {
                    await expect(effects).toSatisfy((e) => [
                      e.exists(e.http({ actor: 'public-api', method: 'POST' })),
                    ]);
                  });
                },
              );
            },
          ),
        );
      });
      Rule('local-only subscriptions avoid external service effects', ({ Scenario }) => {
        Scenario('a local-only user activates without payment or ordering', ({ Given }) =>
          Given(
            'Dora has no subscription or downstream effects',
            async ({ clients, request, sandbox, telemetry, effects, When }) => {
              expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);

              await When(
                'Dora subscribes with a payment method',
                async ({ stimulus, Then, And }) => {
                  const response = await stimulus(({ headers }) =>
                    request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                      data: { paymentMethodId: 'pm_dora_unused', userId: 'dora' },
                      headers,
                    }),
                  );

                  await Then(
                    'her subscription is activated entirely within the local path',
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
                  await And('the required effects are observed', async () => {
                    await expect(effects).toSatisfy((e) => [
                      e.exists(e.http({ actor: 'public-api', method: 'POST' })),
                      e.exists(e.db({ actor: 'public-api' })),
                      e.exists(e.cache({ actor: 'public-api', operation: 'SET' })),
                    ]);
                  });
                },
              );
            },
          ),
        );
      });
      Rule('a user can hold only one subscription', ({ Scenario }) => {
        Scenario('a repeated request does not repeat downstream effects', ({ Given }) =>
          Given(
            'Carol already completed one subscription',
            async ({ clients, request, sandbox, telemetry, effects, When }) => {
              expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
              expect(
                (
                  await request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                    data: { paymentMethodId: 'pm_carol_primary', userId: 'carol' },
                  })
                ).status(),
              ).toBe(201);

              await When(
                'Carol submits another subscription request',
                async ({ stimulus, Then, And }) => {
                  const response = await stimulus(({ headers }) =>
                    request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                      data: { paymentMethodId: 'pm_carol_secondary', userId: 'carol' },
                      headers,
                    }),
                  );

                  await Then(
                    'the duplicate is rejected without another downstream flow',
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
                  await And('the required effects are observed', async () => {
                    await expect(effects).toSatisfy((e) => [
                      e.exists(e.http({ actor: 'public-api', method: 'POST' })),
                    ]);
                  });
                },
              );
            },
          ),
        );
        Scenario('concurrent requests create exactly one subscription', ({ Given }) =>
          Given(
            'Bob has no subscription or downstream effects',
            async ({ clients, request, sandbox, telemetry, effects, When }) => {
              expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

              expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);

              await When(
                'two subscription requests arrive together',
                async ({ stimulus, Then, And }) => {
                  const responses = await stimulus(({ headers }) =>
                    Promise.all([
                      request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                        data: { paymentMethodId: 'pm_bob_one', userId: 'bob' },
                        headers,
                      }),
                      request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                        data: { paymentMethodId: 'pm_bob_two', userId: 'bob' },
                        headers,
                      }),
                    ]),
                  );

                  await Then(
                    'exactly one request wins and one complete flow is recorded',
                    async () => {
                      expect(responses.map((response) => response.status()).sort()).toEqual([
                        201, 409,
                      ]);
                      const duplicate = responses.find((response) => response.status() === 409);
                      if (duplicate === undefined) {
                        throw new Error('Expected one duplicate response');
                      }
                      expect(await duplicate.json()).toEqual({
                        outcome: 'duplicate-subscription',
                        userId: 'bob',
                      });
                    },
                  );
                  await And('the required effects are observed', async () => {
                    await expect(effects).toSatisfy((e) => [
                      e.atLeast(2, e.http({ actor: 'public-api', method: 'POST' })),
                      e.exists(e.http({ actor: 'fraud-check', method: 'POST' })),
                      e.exists(e.http({ actor: 'payment-mock', method: 'POST' })),
                      e.exists(e.http({ actor: 'order-service', method: 'POST' })),
                      e.exists(e.db({ actor: 'fraud-check' })),
                      e.exists(e.cache({ actor: 'public-api', operation: 'SET' })),
                      e.exists(
                        e.rpc({ actor: 'order-service', operation: 'SendMessage', service: 'SQS' }),
                      ),
                    ]);
                  });
                  await And('concurrent arrival does not duplicate any effect', async () => {
                    await expectBobDurableState(clients);
                  });
                },
              );
            },
          ),
        );
      });
    });
  },
);
