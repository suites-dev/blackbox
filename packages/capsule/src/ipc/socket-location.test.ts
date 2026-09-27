import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

import { capsuleSocketPath, isWindowsPipePath } from '../records.js';
import { managerRequest } from './client.js';
import { readRequest, sendResponse } from './server.js';

it('derives a project-scoped Unix socket path on POSIX platforms', () => {
  const projectDirectory = join(tmpdir(), 'project');
  const socketPath = capsuleSocketPath({ projectDirectory, sessionId: 'bright-river-ada' }, 'linux');
  expect(dirname(socketPath)).toBe(join(projectDirectory, '.blackbox', 'tmp'));
  expect(socketPath).toMatch(/bb-[0-9a-f]{16}\.sock$/u);
  expect(isWindowsPipePath(socketPath)).toBe(false);
});

it('derives a Windows named pipe bound to both project and session', () => {
  const select = (projectDirectory: string, sessionId: string) =>
    capsuleSocketPath({ projectDirectory, sessionId }, 'win32');
  const pipe = select(join(tmpdir(), 'a'), 'bright-river-ada');
  expect(pipe).toMatch(/^\\\\\.\\pipe\\bb-[0-9a-f]{32}$/u);
  expect(isWindowsPipePath(pipe)).toBe(true);
  expect(select(join(tmpdir(), 'a'), 'bright-river-ada')).toBe(pipe);
  expect(select(join(tmpdir(), 'b'), 'bright-river-ada')).not.toBe(pipe);
  expect(select(join(tmpdir(), 'a'), 'calm-river-ada')).not.toBe(pipe);
});

it('serves the host platform endpoint and keeps equal session names isolated by project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'b'));
  const servers = [];
  try {
    for (const project of ['a', 'b']) {
      const projectDirectory = join(root, project);
      const socketPath = capsuleSocketPath({ projectDirectory, sessionId: 'bright-river-ada' });
      expect(isWindowsPipePath(socketPath)).toBe(process.platform === 'win32');
      if (!isWindowsPipePath(socketPath)) {
        await mkdir(dirname(socketPath), { recursive: true });
      }
      const server = createServer((socket) => {
        void readRequest(socket).then(async (request) => {
          await sendResponse(socket, {
            kind: 'stop-response',
            requestId: `${project}-${request.requestId}`,
            cleanup: 'complete',
          });
        });
      });
      servers.push(server);
      server.listen(socketPath);
      await once(server, 'listening');
      await expect(
        managerRequest({
          socketPath,
          request: { kind: 'stop-request', requestId: 'probe', reason: 'completed' },
        }),
      ).resolves.toEqual({
        kind: 'stop-response',
        requestId: `${project}-probe`,
        cleanup: 'complete',
      });
      await expect(access(join(projectDirectory, '.blackbox', 's'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  } finally {
    for (const server of servers) {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
    await rm(root, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32')(
  'refuses to listen on a Windows pipe name that another server already owns',
  async () => {
    const pipe = capsuleSocketPath({ projectDirectory: tmpdir(), sessionId: `squat-${process.pid}` });
    const squatter = createServer();
    squatter.listen(pipe);
    await once(squatter, 'listening');
    try {
      const second = createServer();
      second.listen(pipe);
      const [error] = (await once(second, 'error')) as [NodeJS.ErrnoException];
      expect(error.code).toBe('EADDRINUSE');
    } finally {
      await new Promise<void>((resolve) =>
        squatter.close(() => {
          resolve();
        }),
      );
    }
  },
);
