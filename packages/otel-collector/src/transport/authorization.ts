import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { StartCollectorInput } from '../model/types.js';
import { RequestFailure } from './response.js';

export function requireAuthorization(input: {
  readonly request: IncomingMessage;
  readonly config: StartCollectorInput;
}): void {
  const header = input.request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    throw new RequestFailure(401, 'A valid collector bearer token is required.');
  }
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(input.config.authorization.token);
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    throw new RequestFailure(401, 'A valid collector bearer token is required.');
  }
}
