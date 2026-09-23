// Same-user concurrency behavior of the compose SUT: public-api serializes
// subscribe calls per userId, so racing requests cannot both create. Single
// source of truth: the spec files under profiles/per-test/ and profiles/per-worker/
// register this suite under their explicit sutIsolation choice.
//
// The suite asserts EXACT global fixture state (exactly one effect of each
// kind), so on a shared stack it needs resetBeforeEach: true.
//
// Each test.step() becomes a playwright.test.step span in the exported
// OpenTelemetry trace, so the step titles below double as trace labels.
import { expect, test } from '../fixtures.js';
import { fixtureControlHeaders } from '../sut.js';
import { registerResetHook, type SuiteOptions } from './suite-options.js';

export function registerConcurrencySuite(options: SuiteOptions): void {
  test.system({ flowId: 'concurrency-carol' }, 'Concurrency', () => {
    registerResetHook(options);

    test('serializes concurrent subscribe calls for one user into one creation and one duplicate rejection', async ({
      act,
      request,
    }) => {
      const responses = await act('Act: POST /subscriptions is sent for carol twice in parallel', () =>
        Promise.all([
          request.post('/subscriptions', {
            data: { userId: 'carol', paymentMethodId: 'pm-carol-1' },
          }),
          request.post('/subscriptions', {
            data: { userId: 'carol', paymentMethodId: 'pm-carol-2' },
          }),
        ]),
      );

      await test.step('Assert: exactly one request creates with 201 and one is rejected with 409, in either order', () => {
        const statuses = responses.map((response) => response.status()).sort((a, b) => a - b);
        expect(statuses).toEqual([201, 409]);
      });

      // harness-only: reads the demo SUT's own fixture-control plane to peek
      // at internal state; a real product exposes no such introspection endpoint.
      await test.step('Assert: exactly one fraud audit, one payment intent, one queue message, and one subscription exist', async () => {
        const state = await request.get('/fixture/state', {
          headers: fixtureControlHeaders(),
        });
        expect(state.status()).toBe(200);
        expect(await state.json()).toMatchObject({
          fraudAudit: [{ userId: 'carol' }],
          payment: { paymentIntents: [{ userId: 'carol' }] },
          queueDepth: 1,
          subscriptions: [{ userId: 'carol' }],
        });
      });
    });
  });
}
