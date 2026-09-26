import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { CollectorAuthorization } from '../model/types.js';
import { RequestFailure } from './response.js';

export type CollectorAuthorizationScope =
  | { readonly kind: 'ingest' }
  | { readonly kind: 'control' };

export function requireAuthorization(input: {
  readonly request: IncomingMessage;
  readonly authorization: CollectorAuthorization;
  readonly scope: CollectorAuthorizationScope;
}): void {
  const header = input.request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    throw new RequestFailure(401, 'A valid collector bearer token is required.');
  }
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(
    input.scope.kind === 'ingest'
      ? input.authorization.ingestToken
      : input.authorization.controlToken,
  );
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    throw new RequestFailure(401, 'A valid collector bearer token is required.');
  }
}
