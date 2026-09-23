import assert from 'node:assert/strict';
import test from 'node:test';

import { OrderService } from './orders.js';

void test('order response cannot settle before the queue send settles', async () => {
  let releaseSend: (() => void) | undefined;
  const messages: unknown[] = [];
  const service = new OrderService({
    async publish(message) {
      messages.push(message);
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
    },
  });
  let settled = false;
  const result = service.create('alice', 'subscription_alice').then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(messages, [
    {
      action: 'subscribe',
      orderId: 'order_alice',
      subscriptionId: 'subscription_alice',
      userId: 'alice',
    },
  ]);
  if (releaseSend === undefined) {
    assert.fail('queue send was not started');
  }
  releaseSend();
  assert.deepEqual(await result, { orderId: 'order_alice', status: 'queued' });
});
