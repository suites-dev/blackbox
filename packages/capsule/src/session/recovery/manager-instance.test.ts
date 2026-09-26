import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { requestFixture } from '../../manager/testing/request.fixture.js';
import { probeManagerInstance } from './manager-instance.js';

it('verifies the exact live manager instance and detects a different identity', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  try {
    await expect(probeManagerInstance({
      socketPath: fixture.socketPath,
      instanceId: 'request-fixture-manager',
    })).resolves.toEqual({ kind: 'manager-instance-exact' });
    await expect(probeManagerInstance({
      socketPath: fixture.socketPath,
      instanceId: 'another-manager',
    })).resolves.toEqual({ kind: 'manager-instance-different' });
  } finally {
    await fixture.close();
  }
});

async function socketFixture(
  connection: (socket: Socket) => void,
): Promise<{ readonly path: string; readonly close: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'capsule-manager-identity-'));
  const path = join(directory, 'manager.sock');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => { sockets.delete(socket); });
    connection(socket);
  });
  server.listen(path);
  await once(server, 'listening');
  return {
    path,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => { resolve(); });
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it('treats a missing socket and EOF before identity as proof the instance is gone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capsule-manager-missing-'));
  const missing = join(directory, 'manager.sock');
  await expect(probeManagerInstance({ socketPath: missing, instanceId: 'expected' }))
    .resolves.toEqual({ kind: 'manager-socket-missing' });
  await rm(directory, { recursive: true, force: true });

  const eof = await socketFixture((socket) => { socket.end(); });
  try {
    await expect(probeManagerInstance({ socketPath: eof.path, instanceId: 'expected' }))
      .resolves.toEqual({ kind: 'manager-socket-missing' });
  } finally {
    await eof.close();
  }
});

it.each([
  { label: 'malformed response', connection: (socket: Socket) => { socket.end('{}\n'); } },
  { label: 'response timeout', connection: (_socket: Socket) => undefined },
])('fails closed on $label', async ({ connection }) => {
  const fixture = await socketFixture(connection);
  try {
    await expect(probeManagerInstance({ socketPath: fixture.path, instanceId: 'expected' }))
      .resolves.toEqual({ kind: 'manager-instance-unavailable' });
  } finally {
    await fixture.close();
  }
});
