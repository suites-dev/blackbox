import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { OrderPublisher } from './orders.js';

export class QueueOrderPublisher implements OrderPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  async publish(message: {
    readonly action: 'subscribe';
    readonly orderId: string;
    readonly subscriptionId: string;
    readonly userId: string;
  }): Promise<void> {
    await this.#client.send(
      new SendMessageCommand({ QueueUrl: this.#queueUrl, MessageBody: JSON.stringify(message) }),
    );
  }
}
