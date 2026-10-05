import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverEntrypoint = fileURLToPath(new URL('../dist/public-api/server.js', import.meta.url));

test('invalid downstream configuration exits before opening infrastructure clients', async () => {
  const child = spawn(process.execPath, [serverEntrypoint], {
    env: {
      FIXTURE_CONTROL_TOKEN: 'startup-test-token',
      FRAUD_CHECK_URL: 'http://unexpected.example',
      ORDER_SERVICE_URL: 'http://order-service:3000',
      PAYMENT_MOCK_URL: 'http://payment-mock:8080',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 2_000);
  const [code, signal] = await once(child, 'close');
  clearTimeout(timeout);

  assert.equal(timedOut, false, 'misconfiguration retained an open process handle');
  assert.equal(signal, null);
  assert.equal(code, 1);
  assert.match(stderr, /FRAUD_CHECK_URL must be http:\/\/fraud-check:3000/u);
  assert.doesNotMatch(stderr, /redis|subscription queue/u);
});
