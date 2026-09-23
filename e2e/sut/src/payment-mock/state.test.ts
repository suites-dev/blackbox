import assert from 'node:assert/strict';
import test from 'node:test';

import { PaymentState } from './state.js';

void test('payment and refund identities are deterministic and resettable', () => {
  const state = new PaymentState();
  const intent = state.createPaymentIntent('alice', 'pm_card_visa');
  assert.deepEqual(intent, {
    id: 'pi_alice1',
    paymentMethodId: 'pm_card_visa',
    status: 'succeeded',
    userId: 'alice',
  });
  assert.match(intent.id, /^pi_[A-Za-z0-9]+$/);
  assert.deepEqual(state.createRefund('pi_alice1'), {
    id: 'refund_1',
    paymentIntentId: 'pi_alice1',
    status: 'succeeded',
  });
  state.reset();
  assert.deepEqual(state.inspect(), { paymentIntents: [], refunds: [] });
  assert.equal(state.createPaymentIntent('bob', 'pm_card_visa').id, 'pi_bob1');
});

void test('inspection returns defensive copies', () => {
  const state = new PaymentState();
  state.createPaymentIntent('alice', 'pm_card_visa');
  const first = state.inspect();
  const inspectedIntent = first.paymentIntents.at(0);
  if (inspectedIntent === undefined) {
    assert.fail('payment intent was not retained');
  }
  Object.defineProperty(inspectedIntent, 'id', { value: 'changed' });
  const retainedIntent = state.inspect().paymentIntents.at(0);
  if (retainedIntent === undefined) {
    assert.fail('payment intent disappeared');
  }
  assert.equal(retainedIntent.id, 'pi_alice1');
});

void test('refunds require an existing intent and refuse repeated refunds', () => {
  const state = new PaymentState();
  assert.throws(() => state.createRefund('pi_missing1'), { code: 'payment-intent-not-found' });
  state.createPaymentIntent('alice', 'pm_card_visa');
  assert.equal(state.createRefund('pi_alice1').id, 'refund_1');
  assert.throws(() => state.createRefund('pi_alice1'), { code: 'refund-already-exists' });
  assert.equal(state.inspect().refunds.length, 1);
});
