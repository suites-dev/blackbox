import assert from 'node:assert/strict';
import test from 'node:test';

import { requireExactEnvironment } from './config.js';
import { fetchJson, requiredText } from './http.js';

void test('required identifiers reject empty and whitespace-only strings', () => {
  assert.throws(() => requiredText({ userId: '' }, 'userId'), { code: 'invalid-body' });
  assert.throws(() => requiredText({ userId: ' \t\n' }, 'userId'), { code: 'invalid-body' });
  assert.equal(requiredText({ userId: 'alice' }, 'userId'), 'alice');
});

void test('downstream requests reject paths that can replace the fixed service origin', async () => {
  await assert.rejects(fetchJson('fraud-check', '//attacker.example/steal'), /absolute HTTP path/);
  await assert.rejects(
    fetchJson('payment-mock', '/\\attacker.example/steal'),
    /absolute HTTP path/,
  );
});

void test('fixed downstream configuration rejects a different destination', (t) => {
  const before = process.env.FRAUD_CHECK_URL;
  t.after(() => {
    if (before === undefined) delete process.env.FRAUD_CHECK_URL;
    else process.env.FRAUD_CHECK_URL = before;
  });
  process.env.FRAUD_CHECK_URL = 'http://attacker.example';
  assert.throws(
    () => requireExactEnvironment('FRAUD_CHECK_URL', 'http://fraud-check:3000'),
    /must be http:\/\/fraud-check:3000/,
  );
});
