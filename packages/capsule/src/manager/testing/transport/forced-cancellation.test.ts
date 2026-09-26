import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { requestFixture } from '../request.fixture.js';

type Fixture = Awaited<ReturnType<typeof requestFixture>>;

function descendantSource(detached: boolean): string {
  return [
    'const { spawn } = require("node:child_process"); ',
    'const child = spawn(process.execPath, ["-e", ',
    '"process.on(\\"SIGINT\\", () => undefined); ',
    'setInterval(() => undefined, 1000)"], ',
    `{ detached: ${String(detached)}, stdio: ["ignore", "inherit", "inherit"] }); `,
    'if (child.pid === undefined) throw new Error("descendant pid unavailable"); ',
    'require("node:fs").writeFileSync(process.argv[1], String(child.pid)); ',
    'process.on("SIGINT", () => undefined); setInterval(() => undefined, 1000)',
  ].join('');
}

async function startHostTree(input: {
  readonly socket: Socket;
  readonly detached: boolean;
  readonly pidPath: string;
  readonly requestId: string;
}): Promise<number> {
  await once(input.socket, 'connect');
  input.socket.write(`${JSON.stringify({
    kind: 'exec-request', requestId: input.requestId,
    name: { kind: 'omitted' }, purpose: 'inspection',
    target: { kind: 'host', argv: [process.execPath, '-e',
      descendantSource(input.detached), input.pidPath] },
  })}\n`);
  let descendantPid = 0;
  await vi.waitFor(async () => {
    descendantPid = Number(await readFile(input.pidPath, 'utf8'));
    expect(descendantPid).toBeGreaterThan(0);
  }, { timeout: 1_000, interval: 10 });
  input.socket.destroy();
  await once(input.socket, 'close');
  return descendantPid;
}

async function stop(fixture: Fixture, requestId: string): Promise<void> {
  await expect(managerRequest({ socketPath: fixture.socketPath,
    request: { kind: 'stop-request', requestId, reason: 'cancelled' },
  })).resolves.toEqual({ kind: 'stop-response', requestId, cleanup: 'complete' });
}

function killIfAlive(pid: number): void {
  if (pid === 0) {
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* The process is already gone. */ }
}

it('terminates an ordinary descendant retaining captured host pipes', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const socket = connect(fixture.socketPath);
  let descendantPid = 0;
  try {
    descendantPid = await startHostTree({ socket, detached: false,
      pidPath: join(fixture.projectDirectory, 'ordinary-descendant.pid'),
      requestId: 'ordinary-descendant' });
    await stop(fixture, 'stop-ordinary-descendant');
    await vi.waitFor(() => {
      expect(() => { process.kill(descendantPid, 0); })
        .toThrow(expect.objectContaining({ code: 'ESRCH' }));
    }, { timeout: 1_000, interval: 10 });
  } finally {
    socket.destroy();
    killIfAlive(descendantPid);
    await fixture.close();
  }
});

it('releases stop when a descendant deliberately leaves the owned process group', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const socket = connect(fixture.socketPath);
  let descendantPid = 0;
  try {
    descendantPid = await startHostTree({ socket, detached: true,
      pidPath: join(fixture.projectDirectory, 'detached-descendant.pid'),
      requestId: 'detached-descendant' });
    await stop(fixture, 'stop-detached-descendant');
    expect(() => { process.kill(descendantPid, 0); }).not.toThrow();
  } finally {
    socket.destroy();
    killIfAlive(descendantPid);
    await fixture.close();
  }
});
