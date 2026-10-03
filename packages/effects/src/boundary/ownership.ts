/** Snapshot JSON data without invoking toJSON or a caller-supplied array iterator. */
export function snapshotJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Expected finite JSON data');
  }
  if (ancestors.has(value)) {
    throw new TypeError('Cyclic input is not JSON data');
  }
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? snapshotArray(value, ancestors)
    : Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, snapshotJson(child, ancestors)]),
      );
  ancestors.delete(value);
  return copy;
}

function snapshotArray(value: readonly unknown[], ancestors: Set<object>): unknown[] {
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) {
    throw new TypeError('Invalid JSON array length');
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError('Sparse arrays are not JSON data');
    }
    copy.push(snapshotJson(value[index], ancestors));
  }
  return copy;
}

/** Only call on rebuilt, package-owned data; never freeze a caller's objects. */
export function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freezeOwned(child);
    }
    Object.freeze(value);
  }
  return value;
}
