import { createHash } from 'node:crypto';

import { canonicalJson } from './jcs.js';

/** Lowercase hex SHA-256 of a string encoded as UTF-8. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** `sha256:<hex>` of a string's UTF-8 bytes. */
export function sha256Label(text: string): string {
  return `sha256:${sha256Hex(text)}`;
}

/** `sha256:<hex>` of a value's RFC 8785 canonical JSON. */
export function canonicalDigest(value: unknown): string {
  return sha256Label(canonicalJson(value));
}
