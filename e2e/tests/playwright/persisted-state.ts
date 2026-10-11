import { expect, type BlackboxSandbox, type RegisteredClients } from '@suites/blackbox-playwright';

import type * as clientDefinitions from '../../.blackbox/clients/index.js';
import type { SubscriptionRow } from './subscription-state.js';

type SubscriptionClients = RegisteredClients<typeof clientDefinitions>;

export function expectClientSandboxEndpoints(
  clients: SubscriptionClients,
  sandbox: BlackboxSandbox,
): void {
  const redisContainer = sandbox.containers.get('redis');
  const postgresContainer = sandbox.containers.get('postgres');
  if (redisContainer === undefined || postgresContainer === undefined) {
    throw new Error('Subscription sandbox must expose its registered database participants');
  }
  const redis = redisContainer.testcontainer;
  const postgres = postgresContainer.testcontainer;
  const redisOptions = clients.redis.options;
  if (redisOptions === undefined) {
    throw new Error('Registered database clients require inspectable sandbox endpoints');
  }
  expect(redisOptions.url).toBe(
    `redis://${redis.host}:${redis.getMappedPort({ containerPort: 6379 })}`,
  );
  expect(clients.postgres.options.host).toBe(postgres.host);
  expect(clients.postgres.options.port).toBe(postgres.getMappedPort({ containerPort: 5432 }));
}

export async function expectPersistedSubscription(
  clients: SubscriptionClients,
  expected: SubscriptionRow,
): Promise<void> {
  expect(await clients.redis.get(`user:${expected.userId}:tier`)).toBe(expected.tier);
  expect(await clients.redis.get(`hint:long:${expected.userId}`)).toBe('1');
  const subscriptions = await clients.postgres.query<SubscriptionRow>(
    'SELECT id, user_id AS "userId", tier, status, payment_intent_id AS "paymentIntentId", order_id AS "orderId" FROM subscriptions WHERE user_id = $1',
    [expected.userId],
  );
  expect(subscriptions.rows).toEqual([expected]);
}
