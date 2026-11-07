import type { JsonValue } from './types.js';

export class StateIdentityError extends Error {
  constructor(readonly reason: 'missing-id' | 'duplicate-id') {
    super(reason);
  }
}

function rows(value: readonly JsonValue[]): Map<string, JsonValue> {
  const result = new Map<string, JsonValue>();
  for (const row of value) {
    if (
      row === null ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      !Object.hasOwn(row, 'id')
    ) {
      throw new StateIdentityError('missing-id');
    }
    const id = (row as { readonly id: JsonValue }).id;
    if (
      (typeof id !== 'string' || id.length === 0) &&
      !(typeof id === 'number' && Number.isFinite(id))
    ) {
      throw new StateIdentityError('missing-id');
    }
    const key = `${typeof id}:${String(id)}`;
    if (result.has(key)) {
      throw new StateIdentityError('duplicate-id');
    }
    result.set(key, row);
  }
  return result;
}
export function validateValue(value: JsonValue): void {
  if (Array.isArray(value)) {
    rows(value);
  }
}
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`;
}
const equal = (a: JsonValue, b: JsonValue): boolean => canonical(a) === canonical(b);
export function diffValue(before: JsonValue, after: JsonValue): JsonValue {
  if (Array.isArray(before) && Array.isArray(after)) {
    const left = rows(before);
    const right = rows(after);
    const added = [...right].filter(([id]) => !left.has(id)).map(([, row]) => row);
    const removed = [...left].filter(([id]) => !right.has(id)).map(([, row]) => row);
    const changed = [...right].flatMap(([id, row]) => {
      const old = left.get(id);
      return old !== undefined && !equal(old, row) ? [{ before: old, after: row }] : [];
    });
    return copyDiff({ added, removed, changed });
  }
  if (Array.isArray(before) !== Array.isArray(after)) {
    throw new Error('State reader changed value kind');
  }
  return copyDiff({ before, after, changed: !equal(before, after) });
}
function copyDiff<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      copyDiff(child);
    }
  }
  return Object.freeze(value);
}
