const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createClient } = require('redis');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const cache = createClient({ url: process.env.REDIS_URL });
cache.on('error', (error) => console.error(error.message));

function send(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function handle(request, response) {
  if (request.method === 'GET' && request.url === '/health') {
    await pool.query('SELECT 1');
    return send(response, 200, { ready: true });
  }
  if (request.method !== 'POST' || request.url !== '/v1/payment_intents') {
    return send(response, 404, { error: 'not-found' });
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) return send(response, 413, { error: 'request-too-large' });
  }
  let payment;
  try { payment = JSON.parse(body); } catch { return send(response, 400, { error: 'invalid-json' }); }
  if (payment?.userId !== 'alice' || payment.paymentMethodId !== 'pm_alice_primary') {
    return send(response, 422, { error: 'unknown-payment-method' });
  }
  const intent = { id: 'pi_' + randomUUID(), status: 'succeeded' };
  await pool.query('INSERT INTO payment_intent (id, status) VALUES ($1, $2)', [intent.id, intent.status]);
  await cache.set('payment-intent:' + payment.userId, intent.id);
  return send(response, 201, intent);
}

async function main() {
  await cache.connect();
  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error.message);
      send(response, 500, { error: 'payment-unavailable' });
    });
  });
  server.listen(8080, '0.0.0.0');
  process.once('SIGTERM', () => {
    server.close(async () => {
      await pool.end();
      cache.destroy();
    });
  });
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
