import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, expect, it, vi } from 'vitest';

import { managerRequest } from './client.js';
import { requestLifetimeCases } from './request-lifetime.fixture.js';
import { readRequest, sendResponse } from './server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it.each(requestLifetimeCases)(
  'waits for terminal $name without arming an orphaning timeout',
  async (testCase) => {
    const directory = await mkdtemp(join(tmpdir(), 'bb-ipc-lifetime-'));
    const socketPath = join(directory, 'manager.sock');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let admit: () => void = () => undefined;
    const admitted = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const server = createServer((socket) => {
      void readRequest(socket).then(async () => {
        admit();
        await held;
        await sendResponse(socket, testCase.response);
      });
    });
    try {
      server.listen(socketPath);
      await once(server, 'listening');
      const timeout = vi.spyOn(Socket.prototype, 'setTimeout');
      const operation = managerRequest({ socketPath, request: testCase.request });
      await admitted;
      await delay(20);
      expect(timeout).not.toHaveBeenCalled();
      release();
      await expect(operation).resolves.toEqual(testCase.response);
    } finally {
      release();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
