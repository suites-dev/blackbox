// Fixture-control surface of the compose SUT: bearer-token authorization,
// reset profiles, group cleanup, and payment-mock's own fixture endpoints.
// Single source of truth: the spec files under profiles/per-test/ and
// profiles/per-worker/ register this suite under their explicit sutIsolation
// choice. The /fixture/reset calls inside the tests are the behavior under
// test, not cleanup.
//
// The payment-mock test asserts counter-based ids (pi_alice1, refund_1) and
// the group-cleanup test arranges a fresh dora subscription, so on a shared
// stack the suite needs resetBeforeEach: true.
//
// Each test.step() becomes a playwright.test.step span in the exported
// OpenTelemetry trace, so the step titles below double as trace labels.
//
// harness-only: this entire suite proves the demo SUT's fixture-control
// plane and its exclusion from proof evidence, not a usage pattern to copy;
// a real product suite has no /fixture/* endpoints to test against.
import { expect, test } from '../fixtures.js';
import { fixtureControlHeaders } from '../sut.js';
import { registerResetHook, type SuiteOptions } from './suite-options.js';

export function registerFixtureControlSuite(options: SuiteOptions): void {
  test.system({ flowId: 'fixture-control' }, 'Fixture control', () => {
    registerResetHook(options);

    test('rejects fixture-control access without a token or with a wrong token', async ({
      act,
      request,
      sutStack,
    }) => {
      // Authorization is checked before any state access, so there is nothing
      // to arrange. This test makes three independent probe requests; v1's
      // act() fixture supports exactly one Act step per attempt (see
      // capture-node/act-step.ts), so one probe must be designated. This
      // test's stored effects-snapshot baseline names `public-api GET
      // /fixture/state 401` as entry, which rules out the payment-mock probe
      // (different service) but matches both this probe and the next one
      // identically; only chronological order, this probe running first,
      // disambiguates them, consistent with entry always landing on the
      // first request across every baseline checked for this migration. The
      // other two probes keep the plain test.step they always used.
      const missingToken = await act(
        'Act: GET /fixture/state without an authorization header',
        () => request.get('/fixture/state'),
      );

      await test.step('Assert: 401 fixture-control-unauthorized without a token', async () => {
        expect(missingToken.status()).toBe(401);
        expect(await missingToken.json()).toMatchObject({
          code: 'fixture-control-unauthorized',
        });
      });

      const wrongToken = await test.step('Act: GET /fixture/state with a wrong bearer token', () =>
        request.get('/fixture/state', {
          headers: fixtureControlHeaders('not-the-token'),
        }));

      await test.step('Assert: 401 fixture-control-unauthorized with a wrong token', async () => {
        expect(wrongToken.status()).toBe(401);
        expect(await wrongToken.json()).toMatchObject({
          code: 'fixture-control-unauthorized',
        });
      });

      const paymentMockUnauthorized =
        await test.step('Act: GET payment-mock /fixture/state without an authorization header', () =>
          request.get(`${sutStack.paymentMockUrl}/fixture/state`));

      await test.step('Assert: payment-mock also answers 401 fixture-control-unauthorized', async () => {
        expect(paymentMockUnauthorized.status()).toBe(401);
        expect(await paymentMockUnauthorized.json()).toMatchObject({
          code: 'fixture-control-unauthorized',
        });
      });
    });

    test('resets to the fresh and comparison-absent profiles and rejects an unknown profile with 400', async ({
      act,
      request,
    }) => {
      // Reset itself is the behavior under test here. This test resets
      // several profiles in a row; v1's act() fixture supports exactly one
      // Act step per attempt (see capture-node/act-step.ts), so one reset
      // must be designated. This test's stored effects-snapshot baseline
      // names `public-api POST /fixture/reset 200` as entry, which matches
      // both the fresh and comparison-absent resets identically (same
      // request and status); only chronological order, fresh running
      // first, disambiguates them, so the loop is unrolled to wrap only
      // that first reset in act(). The unknown-profile probe below is
      // unambiguously excluded (400, not 200) and keeps the plain
      // test.step it always used.
      async function assertCleanReset(
        profile: 'fresh' | 'comparison-absent',
        reset: Awaited<ReturnType<typeof request.post>>,
      ): Promise<void> {
        await test.step(`Assert: 200 with a clean state after the ${profile} reset`, async () => {
          expect(reset.status()).toBe(200);
          const body = (await reset.json()) as {
            redis: Record<string, string>;
            subscriptions: unknown[];
            queueDepth: number;
          };
          expect(body.redis).toEqual({});
          expect(body.subscriptions).toEqual([]);
          expect(body.queueDepth).toBe(0);
        });
      }

      const freshReset = await act('Act: POST /fixture/reset with the fresh profile', () =>
        request.post('/fixture/reset', {
          data: { profile: 'fresh' },
          headers: fixtureControlHeaders(),
        }),
      );
      await assertCleanReset('fresh', freshReset);

      const comparisonAbsentReset =
        await test.step('Act: POST /fixture/reset with the comparison-absent profile', () =>
          request.post('/fixture/reset', {
            data: { profile: 'comparison-absent' },
            headers: fixtureControlHeaders(),
          }));
      await assertCleanReset('comparison-absent', comparisonAbsentReset);

      const invalid = await test.step('Act: POST /fixture/reset with an unknown profile name', () =>
        request.post('/fixture/reset', {
          data: { profile: 'not-a-profile' },
          headers: fixtureControlHeaders(),
        }));

      await test.step('Assert: 400 invalid-profile for the unknown profile', async () => {
        expect(invalid.status()).toBe(400);
        expect(await invalid.json()).toMatchObject({ code: 'invalid-profile' });
      });
    });

    test('group-cleanup restores a clean fixture state after a subscription dirtied it', async ({
      act,
      request,
    }) => {
      await test.step('Arrange: create a subscription for dora so there is state to clean', async () => {
        const subscribe = await request.post('/subscriptions', {
          data: { userId: 'dora', paymentMethodId: 'pm-dora-unused' },
        });
        expect(subscribe.status()).toBe(201);
      });

      const cleanup = await act('Act: POST /fixture/group-cleanup', () =>
        request.post('/fixture/group-cleanup', {
          headers: fixtureControlHeaders(),
        }),
      );

      await test.step('Assert: 200 with empty redis, subscriptions, and queue', async () => {
        expect(cleanup.status()).toBe(200);
        const body = (await cleanup.json()) as {
          redis: Record<string, string>;
          subscriptions: unknown[];
          queueDepth: number;
        };
        expect(body.redis).toEqual({});
        expect(body.subscriptions).toEqual([]);
        expect(body.queueDepth).toBe(0);
      });
    });

    test('payment-mock records payment intents and refunds and rejects unknown or duplicate refunds', async ({
      act,
      request,
      sutStack,
    }) => {
      // This test makes four sequential requests against payment-mock; v1's
      // act() fixture supports exactly one Act step per attempt (see
      // capture-node/act-step.ts). This test's stored effects-snapshot
      // baseline names `payment-mock POST /v1/payment_intents 201` as
      // entry, unambiguously the intent creation below (the only request
      // with that shape), so it alone is designated the Act step. The other
      // three probes keep the plain test.step they always used.
      const intent = await act('Act: POST payment-mock /v1/payment_intents for alice', () =>
        request.post(`${sutStack.paymentMockUrl}/v1/payment_intents`, {
          data: { userId: 'alice', paymentMethodId: 'pm-payment-direct' },
        }),
      );

      await test.step('Assert: 201 with a succeeded payment intent', async () => {
        expect(intent.status()).toBe(201);
        expect(await intent.json()).toEqual({
          id: 'pi_alice1',
          userId: 'alice',
          paymentMethodId: 'pm-payment-direct',
          status: 'succeeded',
        });
      });

      const missingRefund =
        await test.step('Act: POST /v1/refunds for a payment intent that does not exist', () =>
          request.post(`${sutStack.paymentMockUrl}/v1/refunds`, {
            data: { paymentIntentId: 'pi-missing' },
          }));

      await test.step('Assert: 404 payment-intent-not-found for the unknown intent', async () => {
        expect(missingRefund.status()).toBe(404);
        expect(await missingRefund.json()).toMatchObject({
          code: 'payment-intent-not-found',
        });
      });

      const refund = await test.step('Act: POST /v1/refunds for the created payment intent', () =>
        request.post(`${sutStack.paymentMockUrl}/v1/refunds`, {
          data: { paymentIntentId: 'pi_alice1' },
        }));

      await test.step('Assert: 201 with a succeeded refund', async () => {
        expect(refund.status()).toBe(201);
        expect(await refund.json()).toEqual({
          id: 'refund_1',
          paymentIntentId: 'pi_alice1',
          status: 'succeeded',
        });
      });

      const duplicateRefund =
        await test.step('Act: POST /v1/refunds for the same payment intent again', () =>
          request.post(`${sutStack.paymentMockUrl}/v1/refunds`, {
            data: { paymentIntentId: 'pi_alice1' },
          }));

      await test.step('Assert: 409 refund-already-exists for the duplicate refund', async () => {
        expect(duplicateRefund.status()).toBe(409);
        expect(await duplicateRefund.json()).toMatchObject({
          code: 'refund-already-exists',
        });
      });

      await test.step('Assert: payment-mock state holds exactly one intent and one refund', async () => {
        const state = await request.get(`${sutStack.paymentMockUrl}/fixture/state`, {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toEqual({
          paymentIntents: [
            {
              id: 'pi_alice1',
              userId: 'alice',
              paymentMethodId: 'pm-payment-direct',
              status: 'succeeded',
            },
          ],
          refunds: [
            {
              id: 'refund_1',
              paymentIntentId: 'pi_alice1',
              status: 'succeeded',
            },
          ],
        });
      });
    });
  });
}
