import { compareCodeUnits } from '../canonical/jcs.js';
import { InvalidEffectInputError } from '../model/errors.js';

/**
 * A decoded OTLP `AnyValue`. Integers keep their exact decimal text (OTLP JSON
 * may carry int64 as a string or a number) and doubles keep the ECMAScript
 * number-to-string form, so every value has one platform-independent spelling.
 */
export type AttributeValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'int'; readonly value: string }
  | { readonly kind: 'double'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: string }
  | { readonly kind: 'array'; readonly values: readonly AttributeValue[] }
  | { readonly kind: 'kvlist'; readonly values: readonly Attribute[] }
  | { readonly kind: 'empty' };

export interface Attribute {
  readonly key: string;
  readonly value: AttributeValue;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new InvalidEffectInputError(`${path} must be an object.`);
  }
  return value;
}

/** An absent optional OTLP field reads as an empty object. */
export function optionalRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  return value === undefined || value === null ? {} : requireRecord(value, path);
}

export function optionalArray(value: unknown, path: string): readonly unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InvalidEffectInputError(`${path} must be an array.`);
  }
  return value;
}

function decodeInt(value: unknown, path: string): AttributeValue {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^-?\d+$/u.test(text)) {
    throw new InvalidEffectInputError(`${path}.intValue must be an integer or its decimal text.`);
  }
  return { kind: 'int', value: BigInt(text).toString() };
}

function decodeDouble(value: unknown, path: string): AttributeValue {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || (typeof value === 'string' && value.trim() === '')) {
    throw new InvalidEffectInputError(`${path}.doubleValue must be a number.`);
  }
  return { kind: 'double', value: String(number) };
}

function decodeTyped(field: string, value: unknown, path: string): AttributeValue {
  switch (field) {
    case 'stringValue':
      if (typeof value === 'string') {
        return { kind: 'string', value };
      }
      break;
    case 'boolValue':
      if (typeof value === 'boolean') {
        return { kind: 'bool', value };
      }
      break;
    case 'intValue':
      return decodeInt(value, path);
    case 'doubleValue':
      return decodeDouble(value, path);
    case 'bytesValue':
      if (typeof value === 'string') {
        return { kind: 'bytes', value };
      }
      break;
    case 'arrayValue':
      if (isRecord(value)) {
        const values = optionalArray(value.values, `${path}.arrayValue.values`);
        return {
          kind: 'array',
          values: values.map((item, index) => decodeValue(item, `${path}.arrayValue[${index}]`)),
        };
      }
      break;
    case 'kvlistValue':
      if (isRecord(value)) {
        return { kind: 'kvlist', values: decodeAttributes(value.values, `${path}.kvlistValue`) };
      }
      break;
  }
  throw new InvalidEffectInputError(`${path}.${field} is not a valid OTLP value.`);
}

export function decodeValue(value: unknown, path: string): AttributeValue {
  if (value === undefined || value === null) {
    return { kind: 'empty' };
  }
  if (!isRecord(value)) {
    throw new InvalidEffectInputError(`${path} must be an OTLP AnyValue object.`);
  }
  const fields = Object.keys(value);
  if (fields.length === 0) {
    return { kind: 'empty' };
  }
  if (fields.length !== 1) {
    throw new InvalidEffectInputError(`${path} must hold exactly one typed value.`);
  }
  const [field] = fields;
  return decodeTyped(field, value[field], path);
}

/** Decode an OTLP `KeyValue[]`, sorted by key so equal content has one form. */
export function decodeAttributes(value: unknown, path: string): readonly Attribute[] {
  const attributes = optionalArray(value, path).map((item, index) => {
    if (!isRecord(item) || typeof item.key !== 'string') {
      throw new InvalidEffectInputError(`${path}[${index}] must be a key/value pair.`);
    }
    return { key: item.key, value: decodeValue(item.value, `${path}[${index}].value`) };
  });
  return attributes.sort((left, right) => compareCodeUnits(left.key, right.key));
}

/** The first string value for a key, or null when absent or not a string. */
export function stringAttribute(attributes: readonly Attribute[], key: string): string | null {
  const found = attributes.find((attribute) => attribute.key === key);
  return found !== undefined && found.value.kind === 'string' ? found.value.value : null;
}
