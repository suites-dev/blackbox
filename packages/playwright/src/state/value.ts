import { isSecretEnvironmentName } from '../reporting/redaction/secret-environment.js';
import type { JsonValue } from './types.js';

const maxDepth = 16;
const maxNodes = 10_000;
const maxString = 16_384;
const maxBytes = 1_000_000;

/** Copy only bounded JSON data properties; do not invoke getters or custom serializers. */
export function copyValue(input: unknown): JsonValue {
  let nodes = 0;
  const active = new Set<object>();
  function copy(value: unknown, depth: number): JsonValue {
    if (++nodes > maxNodes || depth > maxDepth) {
      throw new Error('State value exceeds limits');
    }
    if (value === null || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.length <= maxString) {
      return value;
    }
    if (typeof value !== 'object') {
      throw new Error('Unsupported state value');
    }
    return copyObject(value, depth);
  }
  function copyObject(value: object, depth: number): JsonValue {
    if (active.has(value)) {
      throw new Error('Unsupported state value');
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
      throw new Error('Unsupported state object');
    }
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') {
        continue;
      }
      if (!descriptor.enumerable || !('value' in descriptor) || key.length > maxString) {
        throw new Error('Unsupported state property');
      }
      result[key] = copy(descriptor.value as unknown, depth + 1);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('Unsupported state property');
    }
    active.delete(value);
    if (Array.isArray(value)) {
      if (
        Object.keys(result).length !== value.length ||
        Object.keys(result).some((key, index) => key !== String(index))
      ) {
        throw new Error('Sparse or extended state array');
      }
      return Object.freeze(Object.values(result));
    }
    return Object.freeze(result);
  }
  const result = copy(input, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
    throw new Error('State value exceeds limits');
  }
  return result;
}

/** Redact both keys and strings, including values under credential-like keys. */
export function redactValue(input: JsonValue, redact: (value: string) => string): JsonValue {
  if (typeof input === 'string') {
    return redact(input);
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return (input as readonly JsonValue[]).map((value) => redactValue(value, redact));
  }
  const out: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(input)) {
    const safeKey = redact(key);
    if (Object.hasOwn(out, safeKey)) {
      throw new Error('Redacted state keys collide');
    }
    out[safeKey] = isSecretEnvironmentName(key) ? '[REDACTED]' : redactValue(value, redact);
  }
  return out;
}
