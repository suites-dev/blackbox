import assert from 'node:assert/strict';
import test from 'node:test';

import { requireExactEnvironment } from './config.js';
import { closeServer, fetchJson, readJsonObject, requiredText, startJsonServer } from './http.js';

void test('a malformed JSON body is rejected with HTTP 400 invalid-json', async (t) => {
  const server = await startJsonServer(0, async ({ request }) => {
    await readJsonObject(request);
    throw new Error('a malformed body must not be parsed into an object');
  });
  t.after(() => closeServer(server));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server must listen on a TCP port');
  }

  const response = await fetch(`http://127.0.0.1:${String(address.port)}/subscriptions`, {
    method: 'POST',
    body: '{',
  });

  assert.equal(response.status, 400);
  const body: unknown = await response.json();
  assert.deepEqual(body, { code: 'invalid-json', error: 'request body must be valid JSON' });
});

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
