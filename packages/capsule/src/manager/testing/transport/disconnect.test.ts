import { once } from 'node:events';
import { connect, type Socket } from 'node:net';

import { expect, it, vi } from 'vitest';

import { readCapsuleActivities, readCapsuleRecord } from '../../../records.js';
import { managerRequest } from '../../../ipc/client.js';
import { requestFixture } from '../request.fixture.js';

it('finishes stop and closes the listener when the requesting client disconnects during cleanup', async () => {
  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const admitted = new Promise<void>((resolve) => { entered = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await requestFixture(() => { entered(); return blocked; });
  const accepted = new Promise<Socket>((resolve) => {
    fixture.manager.server.once('connection', resolve);
  });
  const socket = connect(fixture.socketPath);
  const managerSocket = await accepted;
  try {
    await once(socket, 'connect');
    socket.write(`${JSON.stringify({ kind: 'stop-request', requestId: 'disconnected-stop', reason: 'completed' })}\n`);
    await admitted;
    Object.defineProperty(managerSocket, 'end', {
      configurable: true,
      value: () => {
        managerSocket.emit('error', new Error('stop response transport failed'));
        return managerSocket;
      },
    });
    socket.destroy();
    await once(socket, 'close');
    release();
    await vi.waitFor(async () => {
      expect(await readCapsuleRecord(fixture)).toMatchObject({ state: 'stopped', cleanup: { kind: 'complete' } });
      expect(fixture.manager.server.listening).toBe(false);
    }, { timeout: 1_000, interval: 10 });
  } finally {
    release();
    socket.destroy();
    await fixture.close();
  }
});

it('retains the terminal activity after an exec client disconnects and continues serving', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const socket = connect(fixture.socketPath);
  try {
    await once(socket, 'connect');
    socket.write(`${JSON.stringify({ kind: 'exec-request', requestId: 'disconnected-exec',
      name: { kind: 'omitted' }, purpose: 'stimulus',
      target: { kind: 'host', argv: [process.execPath, '-e', 'setTimeout(() => process.stdout.write("finished"), 100)'] },
    })}\n`);
    await vi.waitFor(async () => {
      expect(await readCapsuleActivities(fixture)).toMatchObject([{ kind: 'running' }]);
    }, { timeout: 1_000, interval: 10 });
    socket.destroy();
    await once(socket, 'close');
    await vi.waitFor(async () => {
      expect(await readCapsuleActivities(fixture)).toMatchObject([
        { kind: 'completed', outcome: { stdout: 'finished', exitCode: 0 } },
      ]);
    }, { timeout: 1_000, interval: 10 });
    await expect(managerRequest({ socketPath: fixture.socketPath,
      request: { kind: 'stop-request', requestId: 'followup-stop', reason: 'completed' },
    })).resolves.toMatchObject({ kind: 'stop-response', cleanup: 'complete' });
  } finally {
    socket.destroy();
    await fixture.close();
  }
});

it('cancels an abandoned interactive execution before serving stop', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const socket = connect(fixture.socketPath);
  try {
    await once(socket, 'connect');
    socket.write(`${JSON.stringify({
      kind: 'interactive-exec-request',
      requestId: 'abandoned-interactive',
      name: { kind: 'omitted' },
      purpose: 'inspection',
      terminal: { columns: 80, rows: 24 },
      target: {
        kind: 'host',
        argv: [process.execPath, '-e', 'setInterval(() => undefined, 1000)'],
      },
    })}\n`);
    await vi.waitFor(async () => {
      expect(await readCapsuleActivities(fixture)).toMatchObject([
        { kind: 'running' },
      ]);
    }, { timeout: 1_000, interval: 10 });
    socket.destroy();
    await once(socket, 'close');
    await expect(managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'stop-request',
        requestId: 'stop-after-abandonment',
        reason: 'cancelled',
      },
    })).resolves.toMatchObject({
      kind: 'stop-response',
      cleanup: 'complete',
    });
    expect(await readCapsuleActivities(fixture)).toMatchObject([
      { kind: 'completed', outcome: { kind: 'signaled', signal: 'SIGINT' } },
    ]);
  } finally {
    socket.destroy();
    await fixture.close();
  }
});
