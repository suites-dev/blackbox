import { types } from 'node:util';
import type { APIRequestContext, APIResponse } from '@playwright/test';

import { copyValue, redactValue } from '../../state/value.js';
import { isObservedResponse } from '../../request/sandbox-request.js';

const responseLimit = 256 * 1024;

async function boundedBody(response: APIResponse): Promise<Buffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.body(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('Response capture timed out')); }, 5_000);
      }),
    ]);
  } finally { if (timer !== undefined) { clearTimeout(timer); } }
}

/** Tracks responses returned by this exact request client without inspecting arbitrary result objects. */
export function outputCapture(request: APIRequestContext, redact: (value: string) => string) {
  return {
    request,
    async capture(value: unknown): Promise<unknown> {
      if (value !== null && typeof value === 'object' && isObservedResponse(request, value)) {
        const response = value as APIResponse;
        const headers = response.headers();
        const bytes = await boundedBody(response);
        if (bytes.byteLength > responseLimit) {
          throw new Error('Response body exceeds output capture limit');
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        let body: unknown;
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
        return {
          kind: 'response',
          status: response.status(),
          headers: redactValue(copyValue(headers), redact),
          body: redactValue(copyValue(body), redact),
        };
      }
      if (value === undefined) {
        return { kind: 'undefined' };
      }
      if (value !== null && typeof value === 'object' && types.isProxy(value)) {
        throw new Error('Output capture does not accept proxies');
      }
      return { kind: 'json', value: redactValue(copyValue(value), redact) };
    },
  };
}
