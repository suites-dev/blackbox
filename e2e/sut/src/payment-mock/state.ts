export interface PaymentIntent {
  readonly id: string;
  readonly paymentMethodId: string;
  readonly status: 'succeeded';
  readonly userId: string;
}

export interface Refund {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly status: 'succeeded';
}

export class PaymentStateError extends Error {
  readonly code: 'payment-intent-not-found' | 'refund-already-exists';

  constructor(code: PaymentStateError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export class PaymentState {
  #paymentSequence = 0;
  #refundSequence = 0;
  readonly #paymentIntents: PaymentIntent[] = [];
  readonly #refunds: Refund[] = [];

  createPaymentIntent(userId: string, paymentMethodId: string): PaymentIntent {
    this.#paymentSequence += 1;
    const intent = {
      id: `pi_${userId}${String(this.#paymentSequence)}`,
      paymentMethodId,
      status: 'succeeded',
      userId,
    } satisfies PaymentIntent;
    this.#paymentIntents.push(intent);
    return intent;
  }

  createRefund(paymentIntentId: string): Refund {
    if (!this.#paymentIntents.some(({ id }) => id === paymentIntentId)) {
      throw new PaymentStateError(
        'payment-intent-not-found',
        `payment intent ${paymentIntentId} does not exist`,
      );
    }
    if (this.#refunds.some((refund) => refund.paymentIntentId === paymentIntentId)) {
      throw new PaymentStateError(
        'refund-already-exists',
        `payment intent ${paymentIntentId} was already refunded`,
      );
    }
    this.#refundSequence += 1;
    const refund = {
      id: `refund_${String(this.#refundSequence)}`,
      paymentIntentId,
      status: 'succeeded',
    } satisfies Refund;
    this.#refunds.push(refund);
    return refund;
  }

  reset(): void {
    this.#paymentSequence = 0;
    this.#refundSequence = 0;
    this.#paymentIntents.length = 0;
    this.#refunds.length = 0;
  }

  inspect(): {
    readonly paymentIntents: readonly PaymentIntent[];
    readonly refunds: readonly Refund[];
  } {
    return {
      paymentIntents: this.#paymentIntents.map((intent) => ({ ...intent })),
      refunds: this.#refunds.map((refund) => ({ ...refund })),
    };
  }
}
