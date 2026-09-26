import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect, type Socket, type Server } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, expect, it } from 'vitest';

import { managerInteractiveRequest, managerRequest } from './client.js';
import { readManagerFrames, readRequest, sendEvent, sendResponse } from './server.js';
import type { CapsuleInteractiveEvent } from '../types.js';

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

it('streams output and controls bidirectionally over a real Unix socket', async () => {
  const received: unknown[] = [];
  const socketPath = await socketServer((socket) => {
    void (async () => {
      const frames = readManagerFrames(socket);
      received.push((await frames.next()).value);
      await sendEvent(socket, {
        kind: 'exec-output',
        requestId: 'interactive-1',
        stream: 'stdout',
        chunk: Buffer.from('live').toString('base64'),
      });
      received.push((await frames.next()).value);
      await sendEvent(socket, {
        kind: 'exec-control-result',
        requestId: 'interactive-1',
        controlId: 'input-1',
        result: { kind: 'delivered', action: 'stdin-chunk', mechanism: 'host-process-stdin' },
      });
      await sendResponse(socket, {
        kind: 'exec-response',
        requestId: 'interactive-1',
        activityId: '00000000-0000-4000-8000-000000000042',
        outcome: {
          kind: 'executable-not-found',
          argv: ['missing'],
          location: { kind: 'host' },
          remediation: 'Install missing',
        },
      });
    })();
  });
  const events: CapsuleInteractiveEvent[] = [];
  async function* controls() {
    await Promise.resolve();
    yield { kind: 'stdin-chunk' as const, controlId: 'input-1', chunk: Buffer.from('secret') };
  }
  const result = await managerInteractiveRequest({
    socketPath,
    request: {
      kind: 'interactive-exec-request',
      requestId: 'interactive-1',
      name: { kind: 'omitted' },
      purpose: 'stimulus',
      target: { kind: 'host', argv: ['missing'] },
      terminal: { columns: 80, rows: 24 },
    },
    controls: controls(),
    onEvent: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  });
  expect(result).toMatchObject({
    kind: 'exec-response',
    requestId: 'interactive-1',
    activityId: '00000000-0000-4000-8000-000000000042',
  });
  expect(events).toEqual([
    { kind: 'output', stream: 'stdout', chunk: Buffer.from('live') },
    {
      kind: 'control-result',
      controlId: 'input-1',
      result: { kind: 'delivered', action: 'stdin-chunk', mechanism: 'host-process-stdin' },
    },
  ]);
  expect(received).toEqual([
    expect.objectContaining({ kind: 'interactive-exec-request', requestId: 'interactive-1' }),
    {
      kind: 'exec-stdin-chunk',
      requestId: 'interactive-1',
      controlId: 'input-1',
      chunk: Buffer.from('secret').toString('base64'),
    },
  ]);
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
