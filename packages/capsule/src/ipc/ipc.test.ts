import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect, type Socket, type Server } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, expect, it } from 'vitest';

import { managerRequest } from './client.js';
import { readRequest, sendResponse } from './server.js';

const resources: { server: Server; directory: string; sockets: Set<Socket> }[] = [];
const request = { kind: 'stop-request', requestId: 'request-42', reason: 'completed' } as const;
const response = { kind: 'stop-response', requestId: 'request-42', cleanup: 'complete' } as const;

async function socketServer(handler: (socket: Socket) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'bb-ipc-'));
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    handler(socket);
  });
  resources.push({ directory, server, sockets });
  const socketPath = join(directory, 'ipc.sock');
  server.listen(socketPath);
  await once(server, 'listening');
  return socketPath;
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    for (const socket of resource.sockets) {
      socket.destroy();
    }
    if (resource.server.listening) {
      await new Promise<void>((resolve) =>
        resource.server.close(() => {
          resolve();
        }),
      );
    }
    await rm(resource.directory, { recursive: true, force: true });
  }
});

it('round-trips an exact request and response through a real Unix socket', async () => {
  let received: unknown;
  const socketPath = await socketServer((socket) => {
    void readRequest(socket).then(async (value) => {
      received = value;
      await sendResponse(socket, response);
    });
  });
  await expect(managerRequest({ socketPath, request })).resolves.toEqual(response);
  expect(received).toEqual(request);
});

it('waits for a complete fragmented response instead of interpreting a partial frame', async () => {
  const socketPath = await socketServer((socket) => {
    socket.once('data', () => {
      socket.write('{"kind":"stop-response",');
      setImmediate(() => socket.end('"requestId":"request-42","cleanup":"complete"}\n'));
    });
  });
  await expect(managerRequest({ socketPath, request })).resolves.toEqual(response);
});

it.each([
  ['malformed JSON', '{bad-json}\n', /JSON|position|property/iu],
  ['truncated frame', '{"kind":"stop-response"}', /Incomplete Capsule manager response/u],
  ['oversized frame', 'x'.repeat(16_777_217), /exceeds 16 MiB/u],
])('rejects a %s response', async (_label, bytes, message) => {
  const socketPath = await socketServer((socket) => {
    socket.once('data', () => socket.end(bytes));
  });
  await expect(managerRequest({ socketPath, request })).rejects.toThrow(message);
});

it.each([
  ['malformed JSON', '{bad-json}\n', /JSON|position|property/iu],
  ['truncated frame', '{"kind":"stop-request"}', /Incomplete Capsule manager request/u],
  ['oversized frame', 'x'.repeat(1_048_577), /exceeds 1 MiB/u],
])('rejects a %s request on the server boundary', async (_label, bytes, message) => {
  let complete: (result: unknown) => void = () => undefined;
  const receive = new Promise<unknown>((resolve) => {
    complete = resolve;
  });
  const socketPath = await socketServer((socket) => {
    void readRequest(socket).then(complete, complete);
  });
  const client = connect(socketPath);
  await once(client, 'connect');
  client.on('error', () => undefined);
  client.end(bytes);
  const error = await receive;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(message);
  client.destroy();
});
