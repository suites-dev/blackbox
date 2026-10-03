import { createServer, type ServerResponse } from 'node:http';

export interface ParallelBarrier {
  readonly url: string;
  close(): Promise<void>;
}

export async function startParallelBarrier(timeoutMs: number): Promise<ParallelBarrier> {
  const pending: ServerResponse[] = [];
  let failed = false;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = (status: number, body: string): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    for (const response of pending.splice(0)) {
      response.statusCode = status;
      response.end(body);
    }
  };

  const server = createServer((request, response) => {
    if (request.url !== '/arrive') {
      response.statusCode = 404;
      response.end('unknown rendezvous path');
      return;
    }
    if (failed) {
      response.statusCode = 409;
      response.end('parallel rendezvous already failed');
      return;
    }
    if (released) {
      response.statusCode = 204;
      response.end();
      return;
    }
    pending.push(response);
    if (pending.length === 2) {
      released = true;
      finish(204, '');
      return;
    }
    timer = setTimeout(() => {
      failed = true;
      finish(408, 'parallel rendezvous timed out');
    }, timeoutMs);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Parallel rendezvous did not expose a TCP address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      failed = true;
      finish(503, 'parallel rendezvous owner closed');
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) {
            resolveClose();
          } else {
            rejectClose(error);
          }
        });
      });
    },
  };
}
