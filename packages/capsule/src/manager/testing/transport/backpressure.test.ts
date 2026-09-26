import { once } from 'node:events';
import { connect, type Socket } from 'node:net';

import { expect, it, vi } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { readCapsuleActivities } from '../../../records.js';
import { requestFixture } from '../request.fixture.js';

function blockSocketWrites(socket: Socket): {
  readonly counts: () => { readonly writes: number; readonly maximumPending: number };
} {
  const callbacks: ((error?: Error | null) => void)[] = [];
  let writes = 0;
  let maximumPending = 0;
  const write = socket.write.bind(socket);
  socket.on('error', () => undefined);
  Object.defineProperty(socket, 'write', {
    configurable: true,
    value: (chunk: string, callback: (error?: Error | null) => void) => {
      writes += 1;
      if (socket.destroyed) {
        setImmediate(() => {
          callback(new Error('client disconnected'));
        });
        return false;
      }
      write(chunk);
      callbacks.push(callback);
      maximumPending = Math.max(maximumPending, callbacks.length);
      return false;
    },
  });
  socket.once('close', () => {
    for (const callback of callbacks.splice(0)) {
      callback(new Error('client disconnected'));
    }
  });
  return { counts: () => ({ writes, maximumPending }) };
}

it('keeps one socket write in flight and terminates after the blocked client disconnects', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const accepted = new Promise<Socket>((resolve) => {
    fixture.manager.server.once('connection', resolve);
  });
  const socket = connect(fixture.socketPath);
  const managerSocket = await accepted;
  try {
    await once(socket, 'connect');
    socket.pause();
    const blocked = blockSocketWrites(managerSocket);
    socket.write(
      `${JSON.stringify({
        kind: 'interactive-exec-request',
        requestId: 'blocked-output',
        name: { kind: 'omitted' },
        purpose: 'inspection',
        terminal: { columns: 80, rows: 24 },
        target: {
          kind: 'host',
          argv: [
            process.execPath,
            '-e',
            `
        process.on('SIGINT', () => undefined);
        const chunk = Buffer.alloc(65536, 120);
        const write = () => {
          while (process.stdout.write(chunk)) {}
          process.stdout.once('drain', write);
        };
        write(); setInterval(() => undefined, 1000);
      `,
          ],
        },
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(blocked.counts().writes).toBe(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(blocked.counts()).toEqual({ writes: 1, maximumPending: 1 });

    const managerClosed = new Promise<void>((resolve) => {
      managerSocket.once('close', () => { resolve(); });
    });
    socket.destroy();
    await Promise.all([once(socket, 'close'), managerClosed]);
    await vi.waitFor(
      async () => {
        expect(await readCapsuleActivities(fixture)).toMatchObject([
          { kind: 'completed', outcome: { kind: 'signaled', signal: 'SIGKILL' } },
        ]);
      },
      { timeout: 1_000, interval: 10 },
    );
    await expect(
      managerRequest({
        socketPath: fixture.socketPath,
        request: { kind: 'stop-request', requestId: 'stop-after-output', reason: 'cancelled' },
      }),
    ).resolves.toMatchObject({ kind: 'stop-response', cleanup: 'complete' });
  } finally {
    socket.destroy();
    await fixture.close();
  }
});
