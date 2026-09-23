// Rejection paths of POST /subscriptions on the compose SUT: unknown users,
// duplicate subscriptions, and input validation. Single source of truth: the
// spec files under profiles/per-test/ and profiles/per-worker/ register this suite
// under their explicit sutIsolation choice.
//
// The suite asserts EXACT global fixture state (untouched state, only-first
// effects), so on a shared stack it needs resetBeforeEach: true.
//
// Each test.step() becomes a playwright.test.step span in the exported
// OpenTelemetry trace, so the step titles below double as trace labels.
import { expect, test } from '../fixtures.js';
import { fixtureControlHeaders } from '../sut.js';
import { registerResetHook, type SuiteOptions } from './suite-options.js';

export function registerSubscriptionRejectionSuite(options: SuiteOptions): void {
  test.system({ flowId: 'subscription-rejection' }, 'Subscription rejection', () => {
    registerResetHook(options);

    test('rejects an unknown user with 404 and leaves no side effects', async ({
      act,
      request,
    }) => {
      const response = await act('Act: POST /subscriptions for ghost-user', () =>
        request.post('/subscriptions', {
          data: { userId: 'ghost-user', paymentMethodId: 'pm-ghost-1' },
        }),
      );

      await test.step('Assert: 404 with the unknown-user outcome', async () => {
        expect(response.status()).toBe(404);
        expect(await response.json()).toEqual({
          outcome: 'unknown-user',
          userId: 'ghost-user',
        });
      });

      // harness-only: reads the demo SUT's own fixture-control plane to peek
      // at internal state; a real product exposes no such introspection endpoint.
      await test.step('Assert: fixture state is untouched, no fraud, payment, redis, or queue effects', async () => {
        const state = await request.get('/fixture/state', {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toMatchObject({
          fraudAudit: [],
          payment: { paymentIntents: [], refunds: [] },
          queueDepth: 0,
          redis: {},
          subscriptions: [],
        });
      });
    });

    test('rejects a second subscription for the same user with 409 before any new downstream work', async ({
      act,
      request,
    }) => {
      await test.step("Arrange: create bob's first subscription", async () => {
        const first = await request.post('/subscriptions', {
          data: { userId: 'bob', paymentMethodId: 'pm-bob-1' },
        });
        expect(first.status()).toBe(201);
      });

      const duplicate = await act('Act: POST /subscriptions for bob a second time', () =>
        request.post('/subscriptions', {
          data: { userId: 'bob', paymentMethodId: 'pm-bob-2' },
        }),
      );

      await test.step('Assert: 409 with the duplicate-subscription outcome', async () => {
        expect(duplicate.status()).toBe(409);
        expect(await duplicate.json()).toEqual({
          outcome: 'duplicate-subscription',
          userId: 'bob',
        });
      });

      // harness-only: reads the demo SUT's own fixture-control plane to peek
      // at internal state; a real product exposes no such introspection endpoint.
      await test.step("Assert: fixture state still holds only the first subscription's effects", async () => {
        const state = await request.get('/fixture/state', {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toMatchObject({
          fraudAudit: [{ userId: 'bob', hintProfile: 'short' }],
          payment: {
            paymentIntents: [{ id: 'pi_bob1', paymentMethodId: 'pm-bob-1', userId: 'bob' }],
          },
          queueDepth: 1,
          subscriptions: [{ userId: 'bob', paymentIntentId: 'pi_bob1', orderId: 'order_bob' }],
        });
      });
    });

    test('rejects malformed subscription bodies with 400 invalid-body', async ({
      act,
      request,
    }) => {
      // Validation runs before any user lookup, so there is nothing to arrange.
      // v1's act() fixture supports exactly one Act step per attempt (see
      // capture-node/act-step.ts), so one of these bodies must be
      // designated. This test's stored effects-snapshot baseline names
      // `public-api POST /subscriptions 400` as entry, count 3, which
      // matches all three bodies identically (same request and status);
      // only chronological order, the empty body running first,
      // disambiguates them, so it alone is pulled out of the loop and
      // wrapped in act(). The other two bodies keep the plain test.step
      // they always used.
      const emptyBody = await act('Act: POST /subscriptions with an empty body', () =>
        request.post('/subscriptions', { data: {} }),
      );

      await test.step('Assert: 400 invalid-body for an empty body', async () => {
        expect(emptyBody.status()).toBe(400);
        expect(await emptyBody.json()).toMatchObject({ code: 'invalid-body' });
      });

      const remainingInvalidBodies = [
        {
          label: 'a blank paymentMethodId',
          data: { userId: 'alice', paymentMethodId: '  ' },
        },
        {
          label: 'a blank userId',
          data: { userId: ' ', paymentMethodId: 'pm-invalid' },
        },
      ] as const;

      for (const { label, data } of remainingInvalidBodies) {
        const response = await test.step(`Act: POST /subscriptions with ${label}`, () =>
          request.post('/subscriptions', { data }));

        await test.step(`Assert: 400 invalid-body for ${label}`, async () => {
          expect(response.status()).toBe(400);
          expect(await response.json()).toMatchObject({ code: 'invalid-body' });
        });
      }
    });
  });
}
