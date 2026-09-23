// Successful subscription flows against the compose SUT. Single source of
// truth: the spec files under profiles/per-test/ and profiles/per-worker/ register
// this suite under their explicit sutIsolation choice. Seeded users: alice,
// bob, carol run the full execution path (fraud, payment, order, queue); dora
// and eve are local-only (redis + postgres only).
//
// The suite asserts EXACT global fixture state, so on a shared stack it needs
// resetBeforeEach: true (see suite-options.ts).
//
// Each test.step() becomes a playwright.test.step span in the exported
// OpenTelemetry trace, so the step titles below double as trace labels.
import { expect, test } from '../fixtures.js';
import { fixtureControlHeaders } from '../sut.js';
import { registerResetHook, type SuiteOptions } from './suite-options.js';

export function registerSubscriptionCreationSuite(options: SuiteOptions): void {
  test.system({ flowId: 'subscription-creation' }, 'Subscription creation', () => {
    registerResetHook(options);

    test('creates an active subscription for a full-path user with fraud, payment, order, and queue effects', async ({
      act,
      request,
    }) => {
      const response = await act('Act: POST /subscriptions for alice', () =>
        request.post('/subscriptions', {
          data: { userId: 'alice', paymentMethodId: 'pm-alice-1' },
        }),
      );

      await test.step('Assert: 201 with an active pro subscription linked to a payment intent and an order', async () => {
        expect(response.status()).toBe(201);
        expect(await response.json()).toEqual({
          userId: 'alice',
          tier: 'pro',
          subscription: { id: 'subscription_alice', status: 'active' },
          paymentIntentId: 'pi_alice1',
          orderId: 'order_alice',
        });
      });

      // harness-only: reads the demo SUT's own fixture-control plane to peek
      // at internal state; a real product exposes no such introspection endpoint.
      await test.step('Assert: fixture state records fraud audit, payment intent, redis keys, and one queued message', async () => {
        const state = await request.get('/fixture/state', {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toMatchObject({
          fraudAudit: [{ userId: 'alice', decision: 'approved', hintProfile: 'long' }],
          payment: {
            paymentIntents: [{ id: 'pi_alice1', userId: 'alice', paymentMethodId: 'pm-alice-1' }],
          },
          queueDepth: 1,
          redis: { 'user:alice:tier': 'pro', 'hint:long:alice': '1' },
          subscriptions: [
            {
              userId: 'alice',
              paymentIntentId: 'pi_alice1',
              orderId: 'order_alice',
            },
          ],
        });
      });

      // harness-only: drains the demo SUT's queue through its own
      // fixture-control plane; a real product gives no such direct queue access.
      await test.step('Assert: draining the queue yields exactly one subscribe message for alice', async () => {
        const drain = await request.post('/fixture/queue/drain', {
          headers: fixtureControlHeaders(),
        });
        expect(drain.status()).toBe(200);
        expect(await drain.json()).toEqual({
          messages: [
            {
              action: 'subscribe',
              orderId: 'order_alice',
              subscriptionId: 'subscription_alice',
              userId: 'alice',
            },
          ],
        });
      });
    });

    test('creates a local-only subscription for dora without fraud, payment, or order calls', async ({
      act,
      request,
    }) => {
      const response = await act('Act: POST /subscriptions for dora', () =>
        request.post('/subscriptions', {
          data: { userId: 'dora', paymentMethodId: 'pm-dora-unused' },
        }),
      );

      await test.step('Assert: 201 with an active subscription and null payment and order references', async () => {
        expect(response.status()).toBe(201);
        expect(await response.json()).toEqual({
          userId: 'dora',
          tier: 'pro',
          subscription: { id: 'subscription_dora', status: 'active' },
          paymentIntentId: null,
          orderId: null,
        });
      });

      // harness-only: reads the demo SUT's own fixture-control plane to peek
      // at internal state; a real product exposes no such introspection endpoint.
      await test.step('Assert: fixture state shows redis and postgres writes only, no downstream effects', async () => {
        const state = await request.get('/fixture/state', {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toMatchObject({
          fraudAudit: [],
          payment: { paymentIntents: [], refunds: [] },
          queueDepth: 0,
          redis: { 'user:dora:tier': 'pro', 'reg:dora': '1' },
          subscriptions: [{ userId: 'dora', paymentIntentId: null, orderId: null }],
        });
      });
    });

    test('serves eve from the preloaded returning hint under the comparison-returning profile', async ({
      act,
      request,
    }) => {
      // The profile is a genuine precondition here: it preloads eve's
      // returning hint, which the subscribe flow then reads.
      // harness-only: seeding happens through the demo SUT's own
      // fixture-control plane; a real product has no such seeding endpoint.
      await test.step('Arrange: seed the comparison-returning profile', async () => {
        const reset = await request.post('/fixture/reset', {
          data: { profile: 'comparison-returning' },
          headers: fixtureControlHeaders(),
        });
        expect(reset.status()).toBe(200);
      });

      const response = await act('Act: POST /subscriptions for eve', () =>
        request.post('/subscriptions', {
          data: { userId: 'eve', paymentMethodId: 'pm-eve-unused' },
        }),
      );

      await test.step('Assert: 201 local-only subscription with null payment and order references', async () => {
        expect(response.status()).toBe(201);
        expect(await response.json()).toMatchObject({
          userId: 'eve',
          paymentIntentId: null,
          orderId: null,
        });
      });

      // harness-only: reads the demo SUT's own fixture-control plane to peek
      // at internal state; a real product exposes no such introspection endpoint.
      await test.step("Assert: fixture state keeps the preloaded returning hint and adds eve's registration keys", async () => {
        const state = await request.get('/fixture/state', {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toMatchObject({
          redis: {
            'hint:returning:eve': '1',
            'user:eve:tier': 'pro',
            'reg:eve': '1',
          },
          payment: { paymentIntents: [] },
          queueDepth: 0,
        });
      });
    });
  });
}
