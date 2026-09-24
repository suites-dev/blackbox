import type { ServerResponse } from 'node:http';

export class RequestFailure extends Error {
  readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = 'RequestFailure';
    this.status = status;
  }
}

export function writeJson(input: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly value: unknown;
}): void {
  const body = `${JSON.stringify(input.value)}\n`;
  input.response.writeHead(input.status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  input.response.end(body);
}
