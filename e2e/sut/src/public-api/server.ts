import { requiredEnvironment, servicePort } from '../lib/config.js';
import { createDatabasePool } from '../lib/database.js';
import { closeServer, startJsonServer } from '../lib/http.js';
import { writeError } from '../lib/log.js';
import { createQueueClient, ensureQueue } from '../lib/queue.js';
import { createRedisConnection } from '../lib/redis.js';
import { retry } from '../lib/retry.js';
import { createPublicApi } from './app.js';
import { DatabaseRepository } from './database-repository.js';
import { createDownstreamClients } from './downstream-clients.js';
import { FixtureControl } from './fixture-control.js';
import { RedisRepository } from './redis-repository.js';
import { SubscriptionService } from './subscriptions.js';

async function main(): Promise<void> {
  const fixtureToken = requiredEnvironment('FIXTURE_CONTROL_TOKEN');
  const pool = createDatabasePool();
  const database = new DatabaseRepository(pool);
  const redisConnection = await retry('redis', createRedisConnection);
  const redis = new RedisRepository(redisConnection);
  const queue = createQueueClient();
  const queueUrl = await retry('subscription queue', () => ensureQueue(queue));
  const downstream = createDownstreamClients({
    fixtureToken,
    fraudUrl: requiredEnvironment('FRAUD_CHECK_URL'),
    orderUrl: requiredEnvironment('ORDER_SERVICE_URL'),
    paymentUrl: requiredEnvironment('PAYMENT_MOCK_URL'),
  });
  await retry('postgres', () => database.ready());
  await retry('downstream services', () => downstream.ready());

  const fixture = new FixtureControl({ database, redis, queue, queueUrl, downstream });
  const subscriptions = new SubscriptionService({
    findUser: (userId) => database.findUser(userId),
    getTier: (userId) => redis.getTier(userId),
    setTier: (userId, tier) => redis.setTier(userId, tier),
    getHint: (key) => redis.getHint(key),
    setHint: (key, value) => redis.setHint(key, value),
    assessFraud: (userId) => downstream.assessFraud(userId),
    createPayment: (userId, paymentMethodId) => downstream.createPayment(userId, paymentMethodId),
    createOrder: (userId, subscriptionId) => downstream.createOrder(userId, subscriptionId),
    insertSubscription: (input) => database.insertSubscription(input),
  });
  const server = await startJsonServer(
    servicePort(),
    createPublicApi({
      fixture,
      fixtureToken,
      subscriptions,
      ready: async () => {
        await Promise.all([database.ready(), redisConnection.ping(), ensureQueue(queue)]);
      },
    }),
  );

  const shutdown = async (): Promise<void> => {
    await closeServer(server);
    await Promise.all([pool.end(), redisConnection.quit()]);
    queue.destroy();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  writeError(error);
  process.exitCode = 1;
});
