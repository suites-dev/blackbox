import { types } from 'node:util';

type AccessorPolicy = 'snapshot' | 'reject';

/** Trusted contracts may snapshot accessors; received telemetry must be inert. */
export function snapshotJson(value: unknown, accessors: AccessorPolicy = 'snapshot'): unknown {
  return snapshot(value, new Set<object>(), accessors);
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError('Telemetry accessors are not JSON data');
  }
  return descriptor.value;
}

function snapshot(value: unknown, ancestors: Set<object>, accessors: AccessorPolicy): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Expected finite JSON data');
  }
  if (accessors === 'reject' && types.isProxy(value)) {
    throw new TypeError('Telemetry proxies are not JSON data');
  }
  if (ancestors.has(value)) {
    throw new TypeError('Cyclic input is not JSON data');
  }
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? snapshotArray(value, ancestors, accessors)
    : Object.fromEntries(
        (accessors === 'reject'
          ? Object.keys(value).map((key) => [key, dataProperty(value, key)] as const)
          : Object.entries(value)
        ).map(([key, child]) => [key, snapshot(child, ancestors, accessors)]),
      );
  ancestors.delete(value);
  return copy;
}

function snapshotArray(
  value: readonly unknown[],
  ancestors: Set<object>,
  accessors: AccessorPolicy,
): unknown[] {
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) {
    throw new TypeError('Invalid JSON array length');
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError('Sparse arrays are not JSON data');
    }
    const child = accessors === 'reject' ? dataProperty(value, String(index)) : value[index];
    copy.push(snapshot(child, ancestors, accessors));
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
