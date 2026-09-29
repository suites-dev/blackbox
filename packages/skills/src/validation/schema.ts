import { problem, type Diagnostic } from './result.js';

type RecordValue = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dereference(schema: RecordValue, root: RecordValue): RecordValue {
  const reference = schema['$ref'];
  if (typeof reference !== 'string') {
    return schema;
  }
  if (!reference.startsWith('#/$defs/') || !isRecord(root['$defs'])) {
    throw new Error('Unsupported bundled schema reference');
  }
  const target = root['$defs'][reference.slice(8)];
  if (!isRecord(target)) {
    throw new Error('Unknown bundled schema reference');
  }
  return target;
}

function scalarMatches(value: unknown, schema: RecordValue): boolean {
  if ('const' in schema && !Object.is(value, schema['const'])) {
    return false;
  }
  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some((entry: unknown) => Object.is(entry, value))) {
    return false;
  }
  if (schema['type'] === 'string') {
    if (typeof value !== 'string') {
      return false;
    }
    const minimum = schema['minLength'];
    const pattern = schema['pattern'];
    return (typeof minimum !== 'number' || [...value].length >= minimum)
      && (typeof pattern !== 'string' || new RegExp(pattern, 'u').test(value));
  }
  if (schema['type'] === 'integer') {
    const minimum = schema['minimum'];
    return typeof value === 'number' && Number.isSafeInteger(value)
      && (typeof minimum !== 'number' || value >= minimum);
  }
  return true;
}

function objectMatches(value: unknown, schema: RecordValue, root: RecordValue, depth: number): boolean {
  if (!isRecord(value) || !isRecord(schema['properties']) || !Array.isArray(schema['required'])) {
    return false;
  }
  const properties = schema['properties'];
  const required = schema['required'] as ReadonlyArray<unknown>;
  if (!required.every((key) => typeof key === 'string' && Object.hasOwn(value, key))) {
    return false;
  }
  if (schema['additionalProperties'] === false
    && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) {
    return false;
  }
  return Object.entries(properties).every(([key, rule]) =>
    !Object.hasOwn(value, key) || matches(value[key], rule, root, depth + 1));
}

function arrayMatches(value: unknown, schema: RecordValue, root: RecordValue, depth: number): boolean {
  if (!Array.isArray(value) || value.length > 10000) {
    return false;
  }
  const minimum = schema['minItems'];
  if (typeof minimum === 'number' && value.length < minimum) {
    return false;
  }
  if (schema['uniqueItems'] === true && new Set(value.map((item: unknown) => JSON.stringify(item))).size !== value.length) {
    return false;
  }
  return value.every((item: unknown) => matches(item, schema['items'], root, depth + 1));
}

function matches(value: unknown, input: unknown, root: RecordValue, depth: number): boolean {
  if (depth > 64 || !isRecord(input)) {
    return false;
  }
  const schema = dereference(input, root);
  const variants = schema['oneOf'];
  if (Array.isArray(variants)) {
    return variants.filter((variant: unknown) => matches(value, variant, root, depth + 1)).length === 1;
  }
  if (schema['type'] === 'object') {
    return objectMatches(value, schema, root, depth);
  }
  if (schema['type'] === 'array') {
    return arrayMatches(value, schema, root, depth);
  }
  if (schema['type'] === 'string' || schema['type'] === 'integer' || 'const' in schema || 'enum' in schema) {
    return scalarMatches(value, schema);
  }
  throw new Error('Unsupported bundled schema rule');
}

/** Validates only trusted bundled schemas. Does not load remote references or execute user code. */
export function validateShape(value: unknown, schema: unknown): ReadonlyArray<Diagnostic> {
  if (!isRecord(schema)) {
    throw new Error('Invalid bundled schema');
  }
  return matches(value, schema, schema, 0) ? [] : [problem(
    'schema.invalid', '$', 'Document does not match the bundled contract. Inspect it locally with a JSON Schema validator.',
  )];
}
