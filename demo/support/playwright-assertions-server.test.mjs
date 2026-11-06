import assert from 'node:assert/strict';
import { connect } from 'node:net';
import test from 'node:test';

import { assertionServer } from './playwright-assertions-server.mjs';

test('owned fixture cleanup closes an incomplete request and reports only the close callback', { timeout: 10_000 }, async (context) => {
  let started;
  const active = new Promise((resolve) => {
    started = resolve;
  });
  const { server, close } = assertionServer((_request, response) => {
    response.writeHead(200);
    response.write('unfinished response');
    started();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const socket = connect(address.port, '127.0.0.1');
  const clients = [socket];
  socket.on('error', () => {
    /* Peer reset is expected when the owned listener forces cleanup. */
  });
  context.after(() => {
    for (const client of clients) client.destroy();
    server.closeAllConnections();
    if (server.listening) server.close();
  });
  await new Promise((resolve) => socket.once('connect', resolve));
  socket.resume();
  socket.write('GET /unfinished HTTP/1.1\r\nHost: localhost\r\n\r\n');
  await active;
  const partial = connect(address.port, '127.0.0.1');
  clients.push(partial);
  partial.on('error', () => { /* Owned incomplete request may be reset by cleanup. */ });
  await new Promise((resolve, reject) => {
    partial.once('error', reject);
    partial.once('connect', resolve);
  });
  partial.resume();
  partial.write('GET /partial HTTP/1.1\r\nHost: localhost\r\n');
  const partialClosed = new Promise((resolve) => partial.once('close', resolve));
  const socketClosed = new Promise((resolve) => socket.once('close', resolve));
  const result = await close(20);
  assert.deepEqual(result, { closed: true, forced: true });
  assert.equal(server.listening, false, 'A claimed cleanup must release the actual listener');
  await socketClosed;
  await partialClosed;
  assert.equal(socket.destroyed, true, 'The incomplete HTTP socket must be gone');
  assert.equal(partial.destroyed, true);
});

test('an idle fixture closes without waiting for the force deadline', async (context) => {
  const { server, close } = assertionServer((_request, response) => response.end('{}'));
  context.after(() => {
    server.closeAllConnections();
    if (server.listening) server.close();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  assert.deepEqual(await close(), { closed: true, forced: false });
  assert.equal(server.listening, false);
});
