import { types } from 'node:util';
import type { EffectSnapshotValue } from '../model.js';

interface Walk {
  readonly ancestors: Set<object>;
  nodes: number;
}

function property(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError('Effect snapshot values must contain inert JSON data');
  }
  return descriptor.value;
}

function container(value: object, walk: Walk, depth: number): EffectSnapshotValue {
  if (types.isProxy(value) || walk.ancestors.has(value)) {
    throw new TypeError('Effect snapshot values cannot contain proxies or cycles');
  }
  walk.ancestors.add(value);
  let copied: EffectSnapshotValue;
  if (Array.isArray(value)) {
    if (value.length > 10_000) {
      throw new RangeError('Effect snapshot value exceeds 10000 nodes');
    }
    copied = Array.from({ length: value.length }, (_, index) =>
      visit(property(value, String(index)), walk, depth + 1),
    );
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Effect snapshot objects must be plain JSON records');
    }
    copied = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, visit(property(value, key), walk, depth + 1)]),
    );
  }
  walk.ancestors.delete(value);
  return copied;
}

function visit(value: unknown, walk: Walk, depth: number): EffectSnapshotValue {
  if (++walk.nodes > 10_000 || depth > 32) {
    throw new RangeError('Effect snapshot value exceeds its node or depth limit');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Effect snapshot values must be finite JSON data');
  }
  return container(value, walk, depth);
}

/** A detached, key-sorted JSON value with bounded depth and work. */
export function snapshotValue(value: unknown): EffectSnapshotValue {
  const copied = visit(value, { ancestors: new Set(), nodes: 0 }, 0);
  if (Buffer.byteLength(JSON.stringify(copied), 'utf8') > 1_048_576) {
    throw new RangeError('Effect snapshot value exceeds one MiB');
  }
  return copied;
}
