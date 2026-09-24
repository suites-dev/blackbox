import type { ServerResponse } from 'node:http';
import type { ReportFailure } from '../model/provider.js';

export interface HttpResult {
  status: number;
  contentType: string;
  body: string;
}

export function jsonResult(input: { status: number; document: unknown }): HttpResult {
  return {
    status: input.status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(input.document),
  };
}

export function failureResult(input: { failure: ReportFailure }): HttpResult {
  const status = {
    'not-found': 404,
    'invalid-request': 400,
    'artifact-unavailable': 422,
    'provider-error': 500,
  }[input.failure.code];
  return jsonResult({ status, document: input.failure });
}

export function writeResponse(input: {
  response: ServerResponse;
  result: HttpResult;
  head: boolean;
}): void {
  input.response.writeHead(input.result.status, {
    'Content-Type': input.result.contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  });
  input.response.end(input.head ? undefined : input.result.body);
}
