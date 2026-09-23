import { createHash, timingSafeEqual } from 'node:crypto';

import { HttpError } from './lib/http.js';

export function requireFixtureControl(
  authorization: string | readonly string[] | undefined,
  expectedToken: string,
): void {
  if (expectedToken.trim().length === 0) {
    throw new Error('fixture control token must contain a non-whitespace secret');
  }
  const supplied = typeof authorization === 'string' ? authorization : '';
  const expected = `Bearer ${expectedToken}`;
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  if (!timingSafeEqual(suppliedDigest, expectedDigest)) {
    throw new HttpError(401, 'fixture-control-unauthorized', 'fixture control credential required');
  }
}
