import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capsuleSessionDirectory } from '@suites/blackbox-capsule-internal';
import { cliExecutable } from '../../testing/cli-path.fixture.js';

const cli = cliExecutable();
export const fixtureActivityId = '00000000-0000-4000-8000-000000000042';

export async function commandFixture(state: 'running' | 'stopped') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bb-cli-')));
  const sessionId = 'quiet-river-ada';
  const artifactRoot = capsuleSessionDirectory({ projectDirectory: directory, sessionId });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(directory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  const socketPath = join(directory, 'manager.sock');
  const record = {
    schemaVersion: 1,
    sessionId,
    executionId: '00000000-0000-4000-8000-000000000001',
    system: 'orders',
    title: 'Orders demo',
    description: { kind: 'provided', value: 'Recorded orders experiment' },
    state,
    revision: 1,
    admittedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    manager: { kind: 'started', pid: process.pid },
    socketPath,
    entrypoint: {
      kind: 'available',
      value: { url: 'http://127.0.0.1:4567', host: '127.0.0.1', port: 4567, protocol: 'http' },
    },
    artifactRoot,
    containers: [],
    networks: [],
    volumes: [],
    cleanup: { kind: state === 'stopped' ? 'complete' : 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'available', value: 'capsule-orders' },
    readiness: {
      kind: 'available',
      value: { url: 'http://127.0.0.1:4567/health', status: 'ready', durationMs: 10 },
    },
  };
  await writeFile(join(artifactRoot, 'session.json'), JSON.stringify(record));
  await writeFile(join(artifactRoot, 'activities.json'), '[]');
  await writeFile(
    join(artifactRoot, 'progress.json'),
    JSON.stringify({ schemaVersion: 1, kind: 'capsule-progress', events: [] }),
  );
  return { directory, sessionId, socketPath, artifactRoot, record };
}

export async function runCli(input: { directory: string; argv: readonly string[] }) {
  const child = spawn(process.execPath, [cli, ...input.argv], {
    cwd: input.directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      resolve(code);
    });
  });
  return { status, stdout, stderr };
}

export async function fakeManager(input: {
  socketPath: string;
  outcome: Readonly<Record<string, unknown>>;
}) {
  const requests: unknown[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let bytes = '';
    socket.setEncoding('utf8').on('data', (chunk: string) => {
      bytes += chunk;
      if (!bytes.includes('\n')) {
        return;
      }
      const request = JSON.parse(bytes.slice(0, bytes.indexOf('\n'))) as { requestId: string };
      requests.push(request);
      socket.end(
        `${JSON.stringify({
          kind: 'exec-response',
          requestId: request.requestId,
          activityId: fixtureActivityId,
          outcome: input.outcome,
        })}\n`,
      );
    });
  });
  server.listen(input.socketPath);
  await once(server, 'listening');
  return {
    requests,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

export async function removeFixture(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
