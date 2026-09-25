import { once } from 'node:events';
import { connect } from 'node:net';

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
  const socket = connect(fixture.socketPath);
  try {
    await once(socket, 'connect');
    socket.write(`${JSON.stringify({ kind: 'stop-request', requestId: 'disconnected-stop', reason: 'completed' })}\n`);
    await admitted;
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
    socket.write(`${JSON.stringify({ kind: 'exec-request', requestId: 'disconnected-exec', purpose: 'stimulus',
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
