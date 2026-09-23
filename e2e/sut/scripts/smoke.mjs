import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { DriverFence } from './driver-fence.mjs';

const compose = ['compose', '--project-name', 'current-dev-compose-smoke', '--file', 'compose.yml'];
const origin = `http://127.0.0.1:${process.env.PUBLIC_API_PORT ?? '43180'}`;
const paymentOrigin = `http://127.0.0.1:${process.env.PAYMENT_MOCK_PORT ?? '43183'}`;
const fixtureToken = process.env.FIXTURE_CONTROL_TOKEN ?? 'local-fixture-control-token';
const fence = new DriverFence();

async function command(arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', arguments_, {
      env: { ...process.env, FIXTURE_CONTROL_TOKEN: fixtureToken },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker ${arguments_.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

async function request(path, options = {}) {
  return requestAt(origin, path, options);
}

async function fixtureRequest(path, options = {}) {
  return fixtureRequestAt(origin, path, options);
}

async function fixtureRequestAt(base, path, options = {}) {
  fence.assertFixtureControlAllowed();
  return requestAt(base, path, {
    ...options,
    headers: { authorization: `Bearer ${fixtureToken}`, ...options.headers },
  });
}

async function requestAt(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const body = await response.json();
  return { body, status: response.status };
}

async function postProduct(path, body = {}) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

async function postFixture(path, body = {}) {
  return fixtureRequest(path, { method: 'POST', body: JSON.stringify(body) });
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await request('/health');
      if (response.status === 200) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw lastError ?? new Error('health did not become ready');
}

async function waitForState(predicate) {
  let state;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ({ body: state } = await fixtureRequest('/fixture/state'));
    if (predicate(state)) return state;
    await delay(250);
  }
  throw new Error(`state did not settle: ${JSON.stringify(state)}`);
}

async function reset(profile = 'fresh') {
  const response = await postFixture('/fixture/reset', { profile });
  assert.equal(response.status, 200);
}

async function subscribe(userId) {
  return fence.measure(() => subscriptionRequest(userId));
}

async function subscriptionRequest(userId) {
  return postProduct('/subscriptions', { userId, paymentMethodId: 'pm_card_visa' });
}

async function verifyAlice() {
  await reset();
  const response = await subscribe('alice');
  assert.equal(response.status, 201);
  assert.equal(response.body.tier, 'pro');
  assert.equal(response.body.subscription.status, 'active');
  assert.match(response.body.paymentIntentId, /^pi_[A-Za-z0-9]+$/);
  const state = await waitForState((candidate) => candidate.queueDepth === 1);
  assert.deepEqual(
    state.subscriptions.map(({ userId }) => userId),
    ['alice'],
  );
  assert.deepEqual(
    state.fraudAudit.map(({ userId }) => userId),
    ['alice'],
  );
  assert.deepEqual(
    state.payment.paymentIntents.map(({ userId }) => userId),
    ['alice'],
  );
  assert.deepEqual(state.payment.refunds, []);
  assert.equal(state.redis['hint:long:alice'], '1');
  assert.equal(state.redis['user:alice:tier'], 'pro');

  const duplicate = await subscribe('alice');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.outcome, 'duplicate-subscription');
  const malformed = await fence.measure(() =>
    request('/subscriptions', { method: 'POST', body: '{' }),
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'invalid-json');
  const whitespace = await fence.measure(() =>
    postProduct('/subscriptions', { userId: '   ', paymentMethodId: 'pm_card_visa' }),
  );
  assert.equal(whitespace.status, 400);
  assert.equal(whitespace.body.code, 'invalid-body');
  const afterFailures = await waitForState((candidate) => candidate.queueDepth === 1);
  assert.equal(afterFailures.subscriptions.length, 1);
  assert.equal(afterFailures.fraudAudit.length, 1);
  assert.equal(afterFailures.payment.paymentIntents.length, 1);
}

async function verifyPaymentMock() {
  let response = await fixtureRequestAt(paymentOrigin, '/fixture/reset', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(response.status, 200);
  response = await fence.measure(() =>
    requestAt(paymentOrigin, '/v1/refunds', {
      method: 'POST',
      body: JSON.stringify({ paymentIntentId: 'pi_missing1' }),
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'payment-intent-not-found');
  response = await fence.measure(() =>
    requestAt(paymentOrigin, '/v1/payment_intents', {
      method: 'POST',
      body: JSON.stringify({ userId: 'alice', paymentMethodId: 'pm_card_visa' }),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(response.body.id, 'pi_alice1');
  response = await fence.measure(() =>
    requestAt(paymentOrigin, '/v1/refunds', {
      method: 'POST',
      body: JSON.stringify({ paymentIntentId: 'pi_alice1' }),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(response.body.id, 'refund_1');
  response = await fence.measure(() =>
    requestAt(paymentOrigin, '/v1/refunds', {
      method: 'POST',
      body: JSON.stringify({ paymentIntentId: 'pi_alice1' }),
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'refund-already-exists');
  response = await fixtureRequestAt(paymentOrigin, '/fixture/state');
  assert.equal(response.body.paymentIntents.length, 1);
  assert.equal(response.body.refunds.length, 1);
}

async function verifyGhost() {
  await reset();
  const response = await subscribe('ghost-user');
  assert.equal(response.status, 404);
  assert.equal(response.body.outcome, 'unknown-user');
  const { body: state } = await fixtureRequest('/fixture/state');
  assert.deepEqual(state.subscriptions, []);
  assert.deepEqual(state.fraudAudit, []);
  assert.deepEqual(state.payment, { paymentIntents: [], refunds: [] });
  assert.deepEqual(state.redis, {});
  assert.equal(state.queueDepth, 0);
}

async function verifySequence() {
  await reset();
  assert.equal((await subscribe('bob')).status, 201);
  const drained = await postFixture('/fixture/queue/drain');
  assert.equal(drained.status, 200);
  assert.deepEqual(
    drained.body.messages.map(({ userId }) => userId),
    ['bob'],
  );
  assert.equal((await subscribe('carol')).status, 201);
  const state = await waitForState((candidate) => candidate.queueDepth === 1);
  assert.deepEqual(
    state.subscriptions.map(({ userId }) => userId),
    ['bob', 'carol'],
  );
  assert.deepEqual(
    state.fraudAudit.map(({ userId }) => userId),
    ['bob', 'carol'],
  );
  assert.deepEqual(
    state.payment.paymentIntents.map(({ userId }) => userId),
    ['bob', 'carol'],
  );
  assert.deepEqual(state.payment.refunds, []);
  assert.equal(state.redis['hint:short:bob'], '1');
  assert.equal(state.redis['hint:long:carol'], '1');
  assert.equal(state.redis['user:bob:tier'], 'pro');
  assert.equal(state.redis['user:carol:tier'], 'pro');
}

async function verifyComparison() {
  await reset('comparison-absent');
  const dora = await subscribe('dora');
  assert.equal(dora.status, 201);
  assert.equal(dora.body.paymentIntentId, null);
  let state = await fixtureRequest('/fixture/state');
  assert.deepEqual(
    state.body.subscriptions.map(({ userId }) => userId),
    ['dora'],
  );
  assert.deepEqual(state.body.fraudAudit, []);
  assert.deepEqual(state.body.payment, { paymentIntents: [], refunds: [] });
  assert.equal(state.body.redis['hint:returning:dora'], undefined);
  assert.equal(state.body.redis['reg:dora'], '1');
  assert.equal(state.body.queueDepth, 0);

  await reset('comparison-returning');
  const eve = await subscribe('eve');
  assert.equal(eve.status, 201);
  assert.equal(eve.body.paymentIntentId, null);
  state = await fixtureRequest('/fixture/state');
  assert.deepEqual(
    state.body.subscriptions.map(({ userId }) => userId),
    ['eve'],
  );
  assert.deepEqual(state.body.fraudAudit, []);
  assert.deepEqual(state.body.payment, { paymentIntents: [], refunds: [] });
  assert.equal(state.body.redis['hint:returning:eve'], '1');
  assert.equal(state.body.redis['reg:eve'], '1');
  assert.equal(state.body.queueDepth, 0);
}

async function verifyFixtureAuthorization() {
  fence.assertFixtureControlAllowed();
  for (const base of [origin, paymentOrigin]) {
    let response = await requestAt(base, '/fixture/state');
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'fixture-control-unauthorized');
    response = await requestAt(base, '/fixture/state', {
      headers: { authorization: 'Bearer wrong-fixture-token' },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'fixture-control-unauthorized');
  }
}

async function verifyConcurrentDuplicate() {
  await reset();
  const responses = await fence.measure(() =>
    Promise.all([subscriptionRequest('alice'), subscriptionRequest('alice')]),
  );
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
  const duplicate = responses.find(({ status }) => status === 409);
  assert.notEqual(duplicate, undefined);
  assert.equal(duplicate.body.outcome, 'duplicate-subscription');
  const state = await waitForState((candidate) => candidate.queueDepth === 1);
  assert.equal(state.subscriptions.length, 1);
  assert.equal(state.subscriptions[0].orderId, 'order_alice');
  assert.equal(state.fraudAudit.length, 1);
  assert.equal(state.payment.paymentIntents.length, 1);
  const drained = await postFixture('/fixture/queue/drain');
  assert.deepEqual(drained.body.messages, [
    {
      action: 'subscribe',
      orderId: 'order_alice',
      subscriptionId: 'subscription_alice',
      userId: 'alice',
    },
  ]);
}

let started = false;
try {
  await command([...compose, 'up', '--build', '--detach', '--wait']);
  started = true;
  await waitForHealth();
  await command([
    ...compose,
    'exec',
    '--no-TTY',
    'public-api',
    'node',
    'scripts/verify-source-maps.mjs',
    '--embedded',
  ]);
  await verifyFixtureAuthorization();
  await verifyPaymentMock();
  await verifyAlice();
  await verifyConcurrentDuplicate();
  await verifyGhost();
  await verifySequence();
  await verifyComparison();
  const cleanup = await postFixture('/fixture/group-cleanup');
  assert.equal(cleanup.status, 200);
  assert.deepEqual(cleanup.body.subscriptions, []);
  assert.deepEqual(cleanup.body.fraudAudit, []);
  assert.deepEqual(cleanup.body.payment, { paymentIntents: [], refunds: [] });
  assert.deepEqual(cleanup.body.redis, {});
  assert.equal(cleanup.body.queueDepth, 0);
  console.log('PASS current-dev-compose smoke');
} finally {
  if (started && process.env.KEEP_COMPOSE !== '1') {
    await command([...compose, 'down', '--volumes', '--remove-orphans']);
  }
}
