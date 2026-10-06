import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A loopback system that is flaky: GET /health answers 503 "starting" to its
// first request and 200 "ready" to every later one, so a scenario that claims
// 200 fails its first attempt and passes a retry.

export interface FlakySystem {
  readonly url: string;
  /** How many times /health was requested. */
  readonly requests: () => number;
  readonly close: () => Promise<void>;
}

export async function startFlakySystem(): Promise<FlakySystem> {
  let requests = 0;
  const server: Server = createServer((request, response) => {
    request.resume();
    const health = request.url === '/health';
    requests += health ? 1 : 0;
    const ready = health && requests > 1;
    response.writeHead(health ? (ready ? 200 : 503) : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(health ? { status: ready ? 'ready' : 'starting' } : { error: 'not-found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}
