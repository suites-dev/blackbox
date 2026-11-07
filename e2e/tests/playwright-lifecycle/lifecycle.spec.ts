import { expect, test } from '@suites/blackbox-playwright';
import * as clients from '../../.blackbox/clients/index.js';
import { blackboxEnvironment, readFixtureState } from '../playwright/support.js';
import { emptySystemState, type SystemState } from '../playwright/subscription-state.js';

test.use({ blackbox: { system: 'subscription-system', environment: blackboxEnvironment, clients } });

test('lifecycle: PostgreSQL checkpoints and bound verification', async ({ stimulus, state, clients, sandbox }, info) => {
  let reads = 0;
  let calls = 0;
  const subscriptions = state.observe('subscriptions', { rows: async () => {
    reads++;
    return (await clients.postgres.query<{ id: string; status: string }>('SELECT id, status FROM subscriptions ORDER BY id')).rows;
  } });
  const { result, evidence, verify } = await stimulus('When Alice subscribes', ({ request, headers }) => {
    calls++;
    return request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
      data: { paymentMethodId: 'pm_alice_primary', userId: 'alice' }, headers,
    });
  }, { precondition: { name: 'Given no subscription', check: ({ initial }) => {
      expect(initial(subscriptions).rows).toEqual([]);
    } } });
  const captured = evidence.state(subscriptions);
  expect(reads).toBe(2);
  expect(captured.initial.rows).toEqual([]);
  expect(captured.final.rows).toEqual([{ id: 'subscription_alice', status: 'active' }]);
  expect(captured.diff.rows.added).toEqual(captured.final.rows);
  await verify('Then the response and durable state agree', () => {
    expect(result.status()).toBe(201);
    expect(captured.diff.rows.removed).toEqual([]);
  });
  await verify('And the reviewed state matches', () => {
    expect(JSON.stringify(captured.final.rows, null, 2) + '\n').toMatchSnapshot('subscription-state.txt');
  });
  expect(reads).toBe(2);
  expect(calls).toBe(1);
  await info.attach('lifecycle-action', { body: JSON.stringify({ calls, status: result.status(), sandboxId: sandbox.sandboxId, executionId: sandbox.executionId }), contentType: 'application/json' });
});

test('lifecycle: failed precondition sends no action', async ({ stimulus, state, clients, sandbox }, info) => {
  const subscriptions = state.observe('subscriptions', { rows: async () =>
    (await clients.postgres.query<{ id: string; status: string }>('SELECT id, status FROM subscriptions ORDER BY id')).rows });
  let calls = 0;
  await expect(stimulus('When a blocked subscription is attempted', ({ request, headers }) => {
    calls++;
    return request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, { data: { userId: 'alice' }, headers });
  }, { precondition: { name: 'Given a nonexistent subscription', check: ({ initial }) => {
    expect(initial(subscriptions).rows).toHaveLength(1);
  } } })).rejects.toThrow(/toHaveLength/);
  expect(calls).toBe(0);
  expect(await readFixtureState<SystemState>(clients.api)).toEqual(emptySystemState);
  await info.attach('lifecycle-blocked', { body: JSON.stringify({ calls, phase: 'precondition', sandboxId: sandbox.sandboxId, executionId: sandbox.executionId }), contentType: 'application/json' });
});

test('lifecycle: caught capture failure fails the attempt', async ({ stimulus, state, sandbox }, info) => {
  test.fail();
  state.observe('broken', { value: () => { throw new Error('synthetic capture failure'); } });
  let calls = 0;
  await expect(stimulus('When capture fails', () => { calls++; })).rejects.toThrow(/initial state capture failed/);
  expect(calls).toBe(0);
  await info.attach('lifecycle-capture-failed', { body: JSON.stringify({ calls, phase: 'initial-capture', sandboxId: sandbox.sandboxId, executionId: sandbox.executionId }), contentType: 'application/json' });
});
