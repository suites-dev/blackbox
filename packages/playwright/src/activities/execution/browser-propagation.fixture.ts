import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface ObservedRequest {
  readonly path: string;
  readonly traceparent: string;
}

export interface BrowserPropagationFixture {
  readonly origin: string;
  readonly foreignOrigin: string;
  readonly originRequests: readonly ObservedRequest[];
  readonly foreignRequests: readonly ObservedRequest[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Loopback browser fixture did not receive a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function observe(request: IncomingMessage): ObservedRequest {
  const traceparent = request.headers.traceparent;
  return Object.freeze({
    path: request.url ?? '/',
    traceparent: Array.isArray(traceparent) ? (traceparent[0] ?? '') : (traceparent ?? ''),
  });
}

function finish(response: ServerResponse, status: number, headers: Record<string, string>): void {
  response.writeHead(status, headers);
  response.end(status === 200 ? '<!doctype html><title>ok</title>' : undefined);
}

export async function startBrowserPropagationFixture(): Promise<BrowserPropagationFixture> {
  const originRequests: ObservedRequest[] = [];
  const foreignRequests: ObservedRequest[] = [];
  const foreignServer = createServer((request, response) => {
    foreignRequests.push(observe(request));
    finish(response, 200, { 'content-type': 'text/html' });
  });
  const foreignPort = await listen(foreignServer);
  const foreignOrigin = `http://127.0.0.1:${foreignPort}`;
  const originServer = createServer((request, response) => {
    const observed = observe(request);
    originRequests.push(observed);
    if (observed.path === '/same-start') {
      finish(response, 302, { location: '/same-final' });
      return;
    }
    if (observed.path === '/cross-start') {
      finish(response, 302, { location: `${foreignOrigin}/cross-final` });
      return;
    }
    finish(response, 200, { 'content-type': 'text/html' });
  });
  try {
    const originPort = await listen(originServer);
    return Object.freeze({
      origin: `http://127.0.0.1:${originPort}`,
      foreignOrigin,
      originRequests,
      foreignRequests,
      close: async () => {
        await Promise.all([close(originServer), close(foreignServer)]);
      },
    });
  } catch (error) {
    await close(foreignServer);
    throw error;
  }
}
