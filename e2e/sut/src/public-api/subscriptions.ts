export interface UserRecord {
  readonly userId: string;
  readonly tier: string;
  readonly executionPath: 'full' | 'local-only';
  readonly hasSubscription: boolean;
}

export interface CreatedSubscription {
  readonly id: string;
  readonly status: 'active';
}

export interface SubscriptionDependencies {
  findUser(userId: string): Promise<UserRecord | null>;
  getTier(userId: string): Promise<string | null>;
  setTier(userId: string, tier: string): Promise<void>;
  getHint(key: string): Promise<string | null>;
  setHint(key: string, value: string): Promise<void>;
  assessFraud(userId: string): Promise<{ readonly hintProfile: string }>;
  createPayment(userId: string, paymentMethodId: string): Promise<{ readonly id: string }>;
  createOrder(userId: string, subscriptionId: string): Promise<{ readonly orderId: string }>;
  insertSubscription(input: {
    readonly id: string;
    readonly userId: string;
    readonly tier: string;
    readonly paymentIntentId: string | null;
    readonly orderId: string | null;
  }): Promise<CreatedSubscription>;
}

export type SubscriptionResult =
  | { readonly kind: 'unknown-user'; readonly userId: string }
  | { readonly kind: 'duplicate-subscription'; readonly userId: string }
  | {
      readonly kind: 'created';
      readonly userId: string;
      readonly tier: string;
      readonly subscription: CreatedSubscription;
      readonly paymentIntentId: string | null;
      readonly orderId: string | null;
    };

export class SubscriptionWriteError extends Error {
  readonly code = 'subscription-write-failed';

  constructor(cause: unknown) {
    super('subscription write failed after downstream effects settled', { cause });
  }
}

export class SubscriptionService {
  readonly #dependencies: SubscriptionDependencies;
  readonly #sameUserTails = new Map<string, Promise<void>>();

  constructor(dependencies: SubscriptionDependencies) {
    this.#dependencies = dependencies;
  }

  async subscribe(userId: string, paymentMethodId: string): Promise<SubscriptionResult> {
    return this.#serializeSameUser(userId, () => this.#subscribe(userId, paymentMethodId));
  }

  async #subscribe(userId: string, paymentMethodId: string): Promise<SubscriptionResult> {
    const cachedTier = await this.#dependencies.getTier(userId);
    const user = await this.#dependencies.findUser(userId);
    if (user === null) {
      return { kind: 'unknown-user', userId };
    }
    if (user.hasSubscription) {
      return { kind: 'duplicate-subscription', userId };
    }

    const tier = cachedTier ?? user.tier;
    if (cachedTier === null) {
      await this.#dependencies.setTier(userId, tier);
    }

    if (user.executionPath === 'local-only') {
      await this.#dependencies.getHint(`hint:returning:${userId}`);
      await this.#dependencies.setHint(`reg:${userId}`, '1');
      const subscription = await this.#insertSubscription({
        id: `subscription_${userId}`,
        userId,
        tier,
        paymentIntentId: null,
        orderId: null,
      });
      return {
        kind: 'created',
        userId,
        tier,
        subscription,
        paymentIntentId: null,
        orderId: null,
      };
    }

    const assessment = await this.#dependencies.assessFraud(userId);
    const hintKey = `hint:${assessment.hintProfile}:${userId}`;
    await this.#dependencies.setHint(hintKey, '1');
    await this.#dependencies.getHint(hintKey);
    const payment = await this.#dependencies.createPayment(userId, paymentMethodId);
    const subscriptionId = `subscription_${userId}`;
    const order = await this.#dependencies.createOrder(userId, subscriptionId);
    const subscription = await this.#insertSubscription({
      id: subscriptionId,
      userId,
      tier,
      paymentIntentId: payment.id,
      orderId: order.orderId,
    });
    return {
      kind: 'created',
      userId,
      tier,
      subscription,
      paymentIntentId: payment.id,
      orderId: order.orderId,
    };
  }

  async #insertSubscription(input: {
    readonly id: string;
    readonly userId: string;
    readonly tier: string;
    readonly paymentIntentId: string | null;
    readonly orderId: string | null;
  }): Promise<CreatedSubscription> {
    try {
      return await this.#dependencies.insertSubscription(input);
    } catch (error) {
      // This assurance target deliberately preserves earlier external effects.
      // It reports the late failure and never claims rollback or atomic success.
      throw new SubscriptionWriteError(error);
    }
  }

  async #serializeSameUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#sameUserTails.get(userId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#sameUserTails.set(userId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#sameUserTails.get(userId) === tail) {
        this.#sameUserTails.delete(userId);
      }
    }
  }
}
