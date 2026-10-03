import {
  expect,
  test,
  type BlackboxNativeTestArgs,
  type BlackboxNativeWorkerArgs,
  type BlackboxSandboxSuite,
} from '@suites/blackbox-playwright';

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

type SandboxSuite = BlackboxSandboxSuite<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs>;

function declareAcceptedPaymentsRule(suite: SandboxSuite): void {
  suite.describe('Rule: accepted payments are retained as succeeded intents', () => {
    suite.test(
      'Scenario: a valid payment method creates a payment intent',
      async ({ request, sandbox, telemetry, effects }) => {
        expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

        await test.step('Given the payment service has no prior transactions', async () => {
          expect(await readFixtureState<PaymentState>(request, sandbox.entrypoint.url)).toEqual(
            emptyPaymentState,
          );
        });

        const response = await test.step('When Alice submits a payment method', () =>
          request.post(new URL('/v1/payment_intents', sandbox.entrypoint.url).href, {
            data: { paymentMethodId: 'pm_alice_primary', userId: 'alice' },
          }));

        await test.step('Then a succeeded payment intent is returned and retained', async () => {
          const intent = {
            id: 'pi_alice1',
            paymentMethodId: 'pm_alice_primary',
            status: 'succeeded',
            userId: 'alice',
          } as const;
          expect(await expectJson<PaymentIntent>(response, 201)).toEqual(intent);
          expect(await readFixtureState<PaymentState>(request, sandbox.entrypoint.url)).toEqual({
            paymentIntents: [intent],
            refunds: [],
          });
        });
      },
    );
  });
}

function declareSingleRefundRule(suite: SandboxSuite): void {
  suite.describe('Rule: each payment can be refunded at most once', () => {
    suite.test(
      'Scenario: a second refund for the same payment is rejected',
      async ({ request, sandbox, telemetry, effects }) => {
        expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

        await test.step('Given Alice has one succeeded payment', async () => {
          expect(await readFixtureState<PaymentState>(request, sandbox.entrypoint.url)).toEqual(
            emptyPaymentState,
          );
          expect(
            (
              await request.post(new URL('/v1/payment_intents', sandbox.entrypoint.url).href, {
                data: { paymentMethodId: 'pm_alice_refundable', userId: 'alice' },
              })
            ).status(),
          ).toBe(201);
        });

        const firstRefund = await test.step('When the payment is refunded', () =>
          request.post(new URL('/v1/refunds', sandbox.entrypoint.url).href, {
            data: { paymentIntentId: 'pi_alice1' },
          }));
        const repeatedRefund = await test.step('And the same refund is requested again', () =>
          request.post(new URL('/v1/refunds', sandbox.entrypoint.url).href, {
            data: { paymentIntentId: 'pi_alice1' },
          }));

        await test.step('Then the first refund succeeds and the repeated refund is rejected', async () => {
          expect(await expectJson<Refund>(firstRefund, 201)).toEqual({
            id: 'refund_1',
            paymentIntentId: 'pi_alice1',
            status: 'succeeded',
          });
          expect(await expectJson(repeatedRefund, 409)).toMatchObject({
            code: 'refund-already-exists',
          });

          await test.step('And only one refund is retained', async () => {
            const state = await readFixtureState<PaymentState>(request, sandbox.entrypoint.url);
            expect(state.paymentIntents).toHaveLength(1);
            expect(state.refunds).toEqual([
              { id: 'refund_1', paymentIntentId: 'pi_alice1', status: 'succeeded' },
            ]);
          });
        });
      },
    );
  });
}

function declareKnownPaymentsRule(suite: SandboxSuite): void {
  suite.describe('Rule: only known payments can be refunded', () => {
    suite.test(
      'Scenario: an unknown payment intent cannot be refunded',
      async ({ request, sandbox, telemetry, effects }) => {
        expectAttemptEvidenceIdentity({ effects, sandbox, telemetry });

        await test.step('Given the payment service has no prior transactions', async () => {
          expect(await readFixtureState<PaymentState>(request, sandbox.entrypoint.url)).toEqual(
            emptyPaymentState,
          );
        });

        const response = await test.step('When a refund references an unknown payment', () =>
          request.post(new URL('/v1/refunds', sandbox.entrypoint.url).href, {
            data: { paymentIntentId: 'pi_missing1' },
          }));

        await test.step('Then the refund is rejected without recording a transaction', async () => {
          expect(await expectJson(response, 404)).toMatchObject({
            code: 'payment-intent-not-found',
          });
          expect(await readFixtureState<PaymentState>(request, sandbox.entrypoint.url)).toEqual(
            emptyPaymentState,
          );
        });
      },
    );
  });
}

test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', { environment: blackboxEnvironment }, (suite) => {
    declareAcceptedPaymentsRule(suite);
    declareSingleRefundRule(suite);
    declareKnownPaymentsRule(suite);
  });
});
