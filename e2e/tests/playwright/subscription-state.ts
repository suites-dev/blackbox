import { expect } from '@suites/blackbox-playwright';

interface SubscriptionRow {
  readonly id: string;
  readonly userId: string;
  readonly tier: string;
  readonly status: 'active';
  readonly paymentIntentId: string | null;
  readonly orderId: string | null;
}

interface FraudAudit {
  readonly id: string;
  readonly userId: string;
  readonly decision: 'approved';
  readonly hintProfile: 'short' | 'long';
}

interface PaymentIntent {
  readonly id: string;
  readonly paymentMethodId: string;
  readonly status: 'succeeded';
  readonly userId: string;
}

export interface SystemState {
  readonly subscriptions: readonly SubscriptionRow[];
  readonly fraudAudit: readonly FraudAudit[];
  readonly payment: {
    readonly paymentIntents: readonly PaymentIntent[];
    readonly refunds: readonly unknown[];
  };
  readonly queueDepth: number;
  readonly redis: Readonly<Record<string, string>>;
}

export const emptySystemState = {
  fraudAudit: [],
  payment: { paymentIntents: [], refunds: [] },
  queueDepth: 0,
  redis: {},
  subscriptions: [],
} satisfies SystemState;

export function expectSingleBobSubscriptionFlow(state: SystemState): void {
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
