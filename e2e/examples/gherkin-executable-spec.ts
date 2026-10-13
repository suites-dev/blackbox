/**
 * Scoped Gherkin executable specification for Blackbox Playwright.
 *
 * From e2e/, after building the workspace and preparing the local SUT assets:
 * BLACKBOX_E2E_FIXTURE_TOKEN=demo-fixture-token pnpm exec playwright test --config examples/playwright.config.ts
 * Add --list to inspect the three scenarios without acquiring sandboxes.
 * Each scenario and outline row receives a fresh sandbox and runs the Background.
 */
/* eslint-disable max-lines-per-function -- Keep the Feature declaration together as one readable specification. */
import { expect, test } from '@suites/blackbox-playwright';

import * as clients from '../.blackbox/clients/index.js';
import { blackboxEnvironment, readFixtureState } from '../tests/playwright/support.js';
import type { SystemState } from '../tests/playwright/subscription-state.js';

test.system('subscription-system', (system) => {
  system.sandbox('default', { environment: blackboxEnvironment, clients }, ({ Feature }) => {
    Feature('Subscription activation', ({ Background, Rule }) => {
      Background('The system starts fresh', ({ Given }) => {
        Given('the subscription state is reset', async ({ clients }) => {
          const response = await clients.api.post('/fixture/reset', {
            data: { profile: 'fresh' },
          });
          expect(response.status()).toBe(200);
        });
      });

      Rule('Full-path subscriptions settle downstream state', ({ Scenario }) => {
        Scenario('Alice activates a subscription', ({ Given }) =>
          Given('Alice has no subscription', async ({ clients, When }) => {
            const before = await clients.postgres.query('SELECT * FROM subscriptions WHERE user_id = $1', ['alice']);
            expect(before.rows).toEqual([]);

            await When(
              'Alice subscribes with a payment method',
              async ({ request, sandbox, stimulus, Then, And, effects }) => {
                const response = await stimulus(({ headers }) =>
                  request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                    data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' },
                    headers,
                  }),
                );

                await Then('an active subscription is returned', async () => {
                  expect(response.status()).toBe(201);
                  expect(await response.json()).toMatchObject({
                    userId: 'alice',
                    subscription: { id: 'subscription_alice', status: 'active' },
                  });
                });

                await And('the subscription is persisted', async () => {
                  const stored = await clients.postgres.query('SELECT status FROM subscriptions WHERE user_id = $1', [
                    'alice',
                  ]);
                  expect(stored.rows).toEqual([{ status: 'active' }]);
                });

                await And('the required downstream effects occurred', async () => {
                  await expect(effects).toSatisfy((e) => [
                    e.exists(e.http({ actor: 'payment-mock', method: 'POST' })),
                    e.exists(e.cache({ actor: 'public-api', operation: 'SET' })),
                  ]);
                });
              },
            );
          }),
        );
      });

      Rule('Local-only subscriptions avoid payment', ({ ScenarioOutline }) => {
        ScenarioOutline('Activate local-only user <userId>', ({ Given, Examples }) => {
          Given('<userId> has no subscription', async ({ row, clients, When }) => {
            expect(await clients.redis.get(`user:${row.userId}:tier`)).toBeNull();

            await When(
              '<userId> subscribes',
              async ({ row, request, sandbox, stimulus, Then, And, effects, clients }) => {
                const response = await stimulus(({ headers }) =>
                  request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
                    data: {
                      userId: row.userId,
                      paymentMethodId: `pm_${row.userId}_unused`,
                    },
                    headers,
                  }),
                );

                await Then('the subscription is active', async () => {
                  expect(response.status()).toBe(201);
                  expect(await response.json()).toMatchObject({
                    userId: row.userId,
                    subscription: { status: 'active' },
                  });
                });

                await And('payment state remains empty', async () => {
                  await expect(effects).toSatisfy((e) => [
                    e.exists(e.http({ actor: 'public-api', method: 'POST' })),
                    e.exists(e.cache({ actor: 'public-api', operation: 'SET' })),
                  ]);
                  expect((await readFixtureState<SystemState>(clients.api)).payment).toEqual({
                    paymentIntents: [],
                    refunds: [],
                  });
                });
              },
            );
          });

          Examples('Seeded local-only users', [{ userId: 'dora' }, { userId: 'eve' }]);
        });
      });
    });
  });
});
