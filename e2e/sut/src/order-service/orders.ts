export interface OrderPublisher {
  publish(message: {
    readonly action: 'subscribe';
    readonly orderId: string;
    readonly subscriptionId: string;
    readonly userId: string;
  }): Promise<void>;
}

export class OrderService {
  readonly #publisher: OrderPublisher;

  constructor(publisher: OrderPublisher) {
    this.#publisher = publisher;
  }

  async create(userId: string, subscriptionId: string): Promise<Record<string, unknown>> {
    const orderId = `order_${userId}`;
    await this.#publisher.publish({
      action: 'subscribe',
      orderId,
      subscriptionId,
      userId,
    });
    return { orderId, status: 'queued' };
  }
}
