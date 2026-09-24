import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

import { capsuleSocketPath } from '../records.js';
import { managerRequest } from './client.js';
import { readRequest, sendResponse } from './server.js';

it('uses the relocated temporary socket and keeps equal session names isolated by project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'b'));
  const servers = [];
  try {
    for (const project of ['a', 'b']) {
      const projectDirectory = join(root, project);
      const socketPath = capsuleSocketPath({ projectDirectory, sessionId: 'bright-river-ada' });
      expect(dirname(socketPath)).toBe(join(projectDirectory, '.blackbox', 'tmp'));
      await mkdir(dirname(socketPath), { recursive: true });
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
