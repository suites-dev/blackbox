import { servicePort } from '../lib/config.js';
import { closeServer, startJsonServer } from '../lib/http.js';
import { writeError } from '../lib/log.js';
import { createQueueClient, ensureQueue } from '../lib/queue.js';
import { retry } from '../lib/retry.js';
import { createOrderService } from './app.js';
import { OrderService } from './orders.js';
import { QueueOrderPublisher } from './queue-publisher.js';

async function main(): Promise<void> {
  const queue = createQueueClient();
  const queueUrl = await retry('subscription queue', () => ensureQueue(queue));
  const server = await startJsonServer(
    servicePort(),
    createOrderService({
      orders: new OrderService(new QueueOrderPublisher(queue, queueUrl)),
      ready: async () => {
        await ensureQueue(queue);
      },
    }),
  );
  const shutdown = async (): Promise<void> => {
    await closeServer(server);
    queue.destroy();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  writeError(error);
  process.exitCode = 1;
});
