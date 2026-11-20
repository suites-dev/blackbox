import assert from 'node:assert/strict';
import test from 'node:test';
import { claimedPaymentEffectCut } from './playwright-payment-proof.mjs';

const paymentPost = { kind: 'http', actor: 'payment-api', operation: 'POST' };

function cut(digest, effects) {
  return { digest, data: { graph: { effects } } };
}

test('payment proof selects the later effects cut linked to the runtime claim', () => {
  const initial = cut('initial', [paymentPost]);
  const later = cut('later', [paymentPost]);
  assert.equal(claimedPaymentEffectCut([initial, later], { evidence: ['later'] }), later);
});

test('payment proof rejects a claim linked only to the initial effects cut', () => {
  const initial = cut('initial', [paymentPost]);
  const later = cut('later', [paymentPost]);
  assert.throws(() => claimedPaymentEffectCut([initial, later], { evidence: ['initial'] }),
    /later.*cut|effects claim/u);
});

test('payment proof rejects a linked later cut without the payment POST', () => {
  const initial = cut('initial', [paymentPost]);
  const later = cut('later', []);
  assert.throws(() => claimedPaymentEffectCut([initial, later], { evidence: ['later'] }),
    /payment HTTP effect/u);
});
