import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { writeError } from './log.js';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface RequestContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
}

export type RequestHandler = (context: RequestContext) => Promise<void>;

export function startJsonServer(port: number, handler: RequestHandler): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    void handler({ request, response, url }).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.status, { code: error.code, error: error.message });
        return;
      }
      writeError(error);
      sendJson(response, 500, { code: 'service-failure', error: 'service failure' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

export async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const received: unknown = chunk;
    if (!(typeof received === 'string' || received instanceof Uint8Array)) {
      throw new HttpError(400, 'invalid-body', 'request body contains an unsupported chunk');
    }
    const buffer = Buffer.from(received);
    length += buffer.length;
    if (length > 1_048_576) {
      throw new HttpError(413, 'payload-too-large', 'request body exceeds one megabyte');
    }
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid-json', 'request body must be valid JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid-body', 'request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function requiredText(body: Readonly<Record<string, unknown>>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'invalid-body', `${field} must be a non-empty string`);
  }
  return value;
}

export async function fetchJson(
  url: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, options);
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${String(response.status)}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${url} returned a non-object JSON response`);
  }
  return value as Record<string, unknown>;
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
