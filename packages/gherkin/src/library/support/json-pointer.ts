import { expect } from '@suites/blackbox-playwright';

// JSON Pointer (RFC 6901) addressing into a state document. A pointer that
// names nothing is reported as not found rather than as undefined, so a
// claim about a missing member can never pass by comparing against nothing.

export type PointerResult =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

const NOT_FOUND = { found: false } as const satisfies PointerResult;

const found = (value: unknown): PointerResult => ({ found: true, value });

// The empty pointer, or `/`-prefixed tokens whose only escapes are ~0 and ~1.
const POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/u;
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;

function unescapeToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function child(value: unknown, token: string): PointerResult {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    if (!ARRAY_INDEX.test(token) || Number(token) >= items.length) {
      return NOT_FOUND;
    }
    return found(items[Number(token)]);
  }
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, token)) {
    return found((value as Readonly<Record<string, unknown>>)[token]);
  }
  return NOT_FOUND;
}

/** Fails the step when `pointer` is not a JSON Pointer. */
export function expectPointer(pointer: string): void {
  expect(pointer, 'JSON Pointer (RFC 6901), such as "" or "/subscriptions/0/id"').toMatch(POINTER);
}

/** Resolves a valid JSON Pointer against a parsed JSON document. */
export function resolvePointer(document: unknown, pointer: string): PointerResult {
  if (!POINTER.test(pointer)) {
    throw new Error(`Not a JSON Pointer: ${JSON.stringify(pointer)}`);
  }
  let current = found(document);
  if (pointer === '') {
    return current;
  }
  for (const token of pointer.slice(1).split('/')) {
    if (!current.found) {
      return NOT_FOUND;
    }
    current = child(current.value, unescapeToken(token));
  }
  return current;
}
