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
