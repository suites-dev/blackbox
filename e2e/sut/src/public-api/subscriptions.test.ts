import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SubscriptionService,
  type SubscriptionDependencies,
  type UserRecord,
} from './subscriptions.js';

function fixture(user: UserRecord | null): {
  readonly calls: string[];
  readonly service: SubscriptionService;
} {
  const calls: string[] = [];
  let hasSubscription = user === null ? false : user.hasSubscription;
  const dependencies = {
    getTier(userId) {
      calls.push(`tier:get:${userId}`);
      return Promise.resolve(null);
    },
    findUser(userId) {
      calls.push(`user:find:${userId}`);
      return Promise.resolve(user === null ? null : { ...user, hasSubscription });
    },
    setTier(userId, tier) {
      calls.push(`tier:set:${userId}:${tier}`);
      return Promise.resolve();
    },
    getHint(key) {
      calls.push(`hint:get:${key}`);
      return Promise.resolve(null);
    },
    setHint(key, value) {
      calls.push(`hint:set:${key}:${value}`);
      return Promise.resolve();
    },
    assessFraud(userId) {
      calls.push(`fraud:${userId}`);
      return Promise.resolve({ hintProfile: userId === 'bob' ? 'short' : 'long' });
    },
    createPayment(userId) {
      calls.push(`payment:${userId}`);
      return Promise.resolve({ id: `pi_${userId}` });
    },
    createOrder(userId, subscriptionId) {
      calls.push(`order:${userId}:${subscriptionId}`);
      return Promise.resolve({ orderId: `order_${userId}` });
    },
    insertSubscription(input) {
      calls.push(`subscription:${input.id}:${input.paymentIntentId ?? 'none'}`);
      hasSubscription = true;
      return Promise.resolve({ id: input.id, status: 'active' as const });
    },
  } satisfies SubscriptionDependencies;
  return { calls, service: new SubscriptionService(dependencies) };
}

void test('unknown users stop after cache and database lookup', async () => {
  const { calls, service } = fixture(null);
  assert.deepEqual(await service.subscribe('ghost-user', 'pm_card_visa'), {
    kind: 'unknown-user',
    userId: 'ghost-user',
  });
  assert.deepEqual(calls, ['tier:get:ghost-user', 'user:find:ghost-user']);
});

void test('full subscriptions await fraud, hint, payment, order, and one insert in order', async () => {
  const { calls, service } = fixture({
    userId: 'alice',
    tier: 'pro',
    executionPath: 'full',
    hasSubscription: false,
  });
  const result = await service.subscribe('alice', 'pm_card_visa');
  assert.equal(result.kind, 'created');
  assert.deepEqual(calls, [
    'tier:get:alice',
    'user:find:alice',
    'tier:set:alice:pro',
    'fraud:alice',
    'hint:set:hint:long:alice:1',
    'hint:get:hint:long:alice',
    'payment:alice',
    'order:alice:subscription_alice',
    'subscription:subscription_alice:pi_alice',
  ]);
});

void test('local-only subscriptions never call fraud, payment, or order', async () => {
  const { calls, service } = fixture({
    userId: 'dora',
    tier: 'pro',
    executionPath: 'local-only',
    hasSubscription: false,
  });
  const result = await service.subscribe('dora', 'pm_card_visa');
  assert.equal(result.kind, 'created');
  assert.deepEqual(calls, [
    'tier:get:dora',
    'user:find:dora',
    'tier:set:dora:pro',
    'hint:get:hint:returning:dora',
    'hint:set:reg:dora:1',
    'subscription:subscription_dora:none',
  ]);
});

void test('a duplicate stops before cache mutation and every downstream effect', async () => {
  const { calls, service } = fixture({
    userId: 'alice',
    tier: 'pro',
    executionPath: 'full',
    hasSubscription: true,
  });
  assert.deepEqual(await service.subscribe('alice', 'pm_card_visa'), {
    kind: 'duplicate-subscription',
    userId: 'alice',
  });
  assert.deepEqual(calls, ['tier:get:alice', 'user:find:alice']);
});

void test('same-user concurrent requests serialize to one effect chain and one duplicate', async () => {
  const { calls, service } = fixture({
    userId: 'alice',
    tier: 'pro',
    executionPath: 'full',
    hasSubscription: false,
  });
  const results = await Promise.all([
    service.subscribe('alice', 'pm_card_visa'),
    service.subscribe('alice', 'pm_card_visa'),
  ]);
  assert.deepEqual(results.map(({ kind }) => kind).sort(), ['created', 'duplicate-subscription']);
  assert.equal(calls.filter((call) => call.startsWith('fraud:')).length, 1);
  assert.equal(calls.filter((call) => call.startsWith('payment:')).length, 1);
  assert.equal(calls.filter((call) => call.startsWith('order:')).length, 1);
  assert.equal(calls.filter((call) => call.startsWith('subscription:')).length, 1);
});

void test('a late subscription write failure preserves prior effects but never reports success', async () => {
  const calls: string[] = [];
  const service = new SubscriptionService({
    getTier: () => Promise.resolve(null),
    findUser: () =>
      Promise.resolve({
        userId: 'alice',
        tier: 'pro',
        executionPath: 'full',
        hasSubscription: false,
      }),
    setTier: () => Promise.resolve(),
    getHint: () => Promise.resolve('1'),
    setHint: () => {
      calls.push('hint');
      return Promise.resolve();
    },
    assessFraud: () => {
      calls.push('fraud');
      return Promise.resolve({ hintProfile: 'long' });
    },
    createPayment: () => {
      calls.push('payment');
      return Promise.resolve({ id: 'pi_alice1' });
    },
    createOrder: () => {
      calls.push('order');
      return Promise.resolve({ orderId: 'order_alice' });
    },
    insertSubscription: () => {
      calls.push('subscription:failed');
      return Promise.reject(new Error('database unavailable'));
    },
  });

  await assert.rejects(service.subscribe('alice', 'pm_card_visa'), {
    code: 'subscription-write-failed',
  });
  assert.deepEqual(calls, ['fraud', 'hint', 'payment', 'order', 'subscription:failed']);
});
