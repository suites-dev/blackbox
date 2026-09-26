import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { StartReportServerInput, ReportServer } from '../model/server.js';
import { selectionQuery } from '../ui/registry-page.js';
import { routeRequest, validSegment } from './routes.js';
import { providerFailure } from './registry.js';
import { failureResult, jsonResult, writeResponse, type HttpResult } from './response.js';

function validateInput(input: StartReportServerInput): void {
  if (!Number.isInteger(input.port) || input.port < 0 || input.port > 65_535) {
    throw new Error('Port must be an integer from 0 through 65535.');
  }
  const types = new Set<string>();
  for (const provider of input.providers) {
    if (!validSegment({ value: provider.type }) || types.has(provider.type)) {
      throw new Error('Report provider types must be unique safe path segments.');
    }
    if (/<\/script/iu.test(provider.view.script) || /<\/style/iu.test(provider.view.styles)) {
      throw new Error('Report provider client views must be safe inline assets.');
    }
    types.add(provider.type);
  }
  if (
    input.selection.kind === 'report' &&
    (!types.has(input.selection.type) || !validSegment({ value: input.selection.id }))
  ) {
    throw new Error('Initial report selection must name a registered type and a valid exact ID.');
  }
}

function rejectedRequest(input: { request: IncomingMessage }): HttpResult | null {
  const { request } = input;
  const authority = `127.0.0.1:${String(request.socket.localPort)}`;
  if (
    request.headers.host !== authority ||
    (request.headers.origin !== undefined && request.headers.origin !== `http://${authority}`)
  ) {
    return jsonResult({
      status: 403,
      document: {
        kind: 'report-failure',
        code: 'invalid-request',
        message: 'Only requests from this local report origin are allowed.',
      },
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResult({
      status: 405,
      document: {
        kind: 'report-failure',
        code: 'invalid-request',
        message: 'Reports are read-only; use GET or HEAD.',
      },
    });
  }
  return null;
}

async function handleRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  config: StartReportServerInput;
}): Promise<void> {
  let result = rejectedRequest(input);
  if (
    result === null &&
    input.config.kind === 'start-scoped-report-server' &&
    input.request.url === '/api/server'
  ) {
    result = jsonResult({ status: 200, document: input.config.identity });
  }
  if (result === null) {
    try {
      result = await routeRequest({
        path: input.request.url ?? '/',
        providers: input.config.providers,
      });
    } catch {
      result = failureResult({ failure: providerFailure() });
    }
  }
  writeResponse({ response: input.response, result, head: input.request.method === 'HEAD' });
}

function closeServer(input: { server: Server }): () => Promise<void> {
  let closed: Promise<void> | null = null;
  return () => {
    if (closed !== null) {
      return closed;
    }
    closed = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        input.server.closeAllConnections();
      }, 1000);
      deadline.unref();
      input.server.close((error) => {
        clearTimeout(deadline);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
      input.server.closeIdleConnections();
    });
    return closed;
  };
}

export async function startReportServer(input: StartReportServerInput): Promise<ReportServer> {
  validateInput(input);
  const server = createServer((request, response) => {
    void handleRequest({ request, response, config: input }).catch(() => response.destroy());
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Report server did not acquire a TCP port.');
  }
  return {
    kind: 'report-server',
    hostname: '127.0.0.1',
    port: address.port,
    url: `http://127.0.0.1:${address.port}/${selectionQuery(input)}`,
    close: closeServer({ server }),
  };
}
