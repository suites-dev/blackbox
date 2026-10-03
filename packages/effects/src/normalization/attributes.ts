import type { EffectScalar } from '../contract.js';
import { array, record } from './values.js';

export type Attributes = Readonly<Partial<Record<string, EffectScalar>>>;

const aliases = [
  ['http.request.method', 'http.method'],
  ['db.operation.name', 'db.operation'],
  ['db.collection.name', 'db.sql.table'],
  ['db.namespace', 'db.name'],
  ['db.system.name', 'db.system'],
  ['messaging.operation.type', 'messaging.operation'],
  ['messaging.destination.name', 'messaging.destination'],
] as const;
const semanticStrings = new Set<string>([
  ...aliases.flat(),
  'http.route',
  'rpc.method',
  'rpc.service',
  'service.name',
]);
const semanticPrefixes = ['http.', 'db.', 'messaging.', 'rpc.'];

function scalar(value: Readonly<Record<string, unknown>>): EffectScalar | undefined {
  const fields = Object.entries(value);
  if (fields.length !== 1) {
    return undefined;
  }
  const [type, candidate] = fields[0];
  if (type === 'stringValue' && typeof candidate === 'string') {
    return candidate;
  }
  if (type === 'boolValue' && typeof candidate === 'boolean') {
    return candidate;
  }
  // Preserve int64 strings; composite values never collide with literal strings.
  if (
    (type === 'intValue' || type === 'doubleValue') &&
    (typeof candidate === 'string' || (typeof candidate === 'number' && Number.isFinite(candidate)))
  ) {
    return candidate;
  }
  return undefined;
}

function valueAt(attribute: Readonly<Record<string, unknown>>, key: string, location: string) {
  const value = record(attribute.value ?? {}, location);
  if (semanticStrings.has(key)) {
    if (
      Object.keys(value).length !== 1 ||
      typeof value.stringValue !== 'string' ||
      value.stringValue.length === 0
    ) {
      throw new TypeError(
        `Semantic attribute ${key} must contain one non-empty stringValue at ${location}`,
      );
    }
  }
  return scalar(value);
}

function resolveAliases(attributes: Partial<Record<string, EffectScalar>>, location: string): void {
  for (const [current, legacy] of aliases) {
    if (
      attributes[current] !== undefined &&
      attributes[legacy] !== undefined &&
      attributes[current] !== attributes[legacy]
    ) {
      throw new TypeError(`Conflicting semantic aliases ${legacy} and ${current} at ${location}`);
    }
    if (attributes[current] === undefined && attributes[legacy] !== undefined) {
      attributes[current] = attributes[legacy];
    }
  }
}

export function attributesAt(input: unknown, location: string, resolve: boolean): Attributes {
  const attributes: Partial<Record<string, EffectScalar>> = {};
  const seen = new Set<string>();
  for (const item of array(input ?? [], location)) {
    const attribute = record(item, location);
    const key = attribute.key;
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`OTLP attribute key must be a non-empty string at ${location}`);
    }
    if (semanticStrings.has(key) || semanticPrefixes.some((prefix) => key.startsWith(prefix))) {
      if (seen.has(key)) {
        throw new TypeError(`Duplicate semantic attribute ${key} at ${location}`);
      }
      seen.add(key);
    }
    const value = valueAt(attribute, key, location);
    if (value !== undefined) {
      Object.defineProperty(attributes, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  if (resolve) {
    resolveAliases(attributes, location);
  }
  return attributes;
}

export function textAttribute(attributes: Attributes, key: string): string {
  const value = attributes[key];
  return typeof value === 'string' ? value : 'unknown';
}
