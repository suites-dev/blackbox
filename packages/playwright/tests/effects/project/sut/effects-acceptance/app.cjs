'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const amqp = require('amqplib');
const { Pool } = require('pg');

const port = Number(process.env.PORT || 8080);
const destinations = Object.freeze({
  alpha: 'acceptance.alpha',
  beta: 'acceptance.beta',
});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'effects-acceptance',
});
const deliveries = new Map();
let rabbitConnection;
let rabbitChannel;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function recordId(pathname, suffix = '') {
  const match = pathname.match(new RegExp(`^/records/(\\d+)${suffix}$`));
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

async function connectRabbit() {
  rabbitConnection = await amqp.connect(process.env.RABBIT_URL);
  rabbitChannel = await rabbitConnection.createConfirmChannel();
  for (const destination of Object.values(destinations)) {
    await rabbitChannel.assertExchange(destination, 'direct', {
      durable: false,
    });
    const queue = `${destination}.observed`;
    await rabbitChannel.assertQueue(queue, { durable: false });
    await rabbitChannel.bindQueue(queue, destination, 'work');
    await rabbitChannel.consume(queue, (message) => {
      if (!message) return;
      const payload = JSON.parse(message.content.toString('utf8'));
      deliveries.set(message.properties.messageId, { destination, payload });
      rabbitChannel.ack(message);
    });
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://fixture.invalid');
  if (req.method === 'GET' && url.pathname === '/health') {
    await pool.query('SELECT 1');
    send(res, 200, { ready: Boolean(rabbitChannel) });
    return;
  }

  const inspectId = req.method === 'GET' ? recordId(url.pathname) : null;
  if (inspectId !== null) {
    const result = await pool.query('SELECT id, value FROM acceptance_records WHERE id = $1', [
      inspectId,
    ]);
    send(res, 200, { row: result.rows[0] ?? null });
    return;
  }

  const insertId = req.method === 'POST' ? recordId(url.pathname) : null;
  if (insertId !== null) {
    const body = await readJson(req);
    const value = typeof body.value === 'string' ? body.value : `record-${insertId}`;
    const result = await pool.query(
      'INSERT INTO acceptance_records(id, value) VALUES ($1, $2) RETURNING id, value',
      [insertId, value],
    );
    send(res, 201, { row: result.rows[0] });
    return;
  }

  const rollbackId = req.method === 'POST' ? recordId(url.pathname, '/rollback') : null;
  if (rollbackId !== null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO acceptance_records(id, value) VALUES ($1, $2)', [
        rollbackId,
        `rolled-back-${rollbackId}`,
      ]);
      await client.query('ROLLBACK');
      send(res, 200, { id: rollbackId, rolledBack: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const publish = req.method === 'POST' ? url.pathname.match(/^\/publish\/(alpha|beta)$/) : null;
  if (publish) {
    const body = await readJson(req);
    const destination = destinations[publish[1]];
    const messageId = randomUUID();
    await new Promise((resolve, reject) => {
      rabbitChannel.publish(
        destination,
        'work',
        Buffer.from(JSON.stringify({ value: body.value ?? publish[1] })),
        { messageId, persistent: false },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    send(res, 202, { brokerConfirmed: true, destination, messageId });
    return;
  }

  const delivery = req.method === 'GET' ? url.pathname.match(/^\/deliveries\/([^/]+)$/) : null;
  if (delivery) {
    send(res, 200, {
      delivery: deliveries.get(decodeURIComponent(delivery[1])) ?? null,
    });
    return;
  }

  send(res, 404, { error: 'not-found' });
}

async function main() {
  await pool.query('SELECT 1');
  await connectRabbit();
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => send(res, 500, { error: error.message }));
  });
  server.listen(port, '0.0.0.0');
  process.on('SIGTERM', () => {
    server.close(async () => {
      await rabbitChannel?.close();
      await rabbitConnection?.close();
      await pool.end();
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
