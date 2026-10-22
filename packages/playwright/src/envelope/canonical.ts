import { createHash } from 'node:crypto';

export type Digest = `sha256:${string}`;

export const canonicalization = 'bb-jcs-1';

/**
 * RFC 8785 style canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, ECMAScript string
 * escaping. Only what a JSON document built from plain data can hold is accepted: `undefined`, functions,
 * non-finite numbers and non-integer numbers throw, so two equal documents can never serialize differently.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Canonical documents hold safe integers only, got ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
  }
  throw new TypeError(`Cannot canonicalize a ${typeof value}`);
}

export function digestBytes(bytes: string | Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function digestOf(value: unknown): Digest {
  return digestBytes(canonicalize(value));
}
