/**
 * RFC 8785 JSON Canonicalization Scheme, restricted to the values an EffectSet
 * may contain: null, booleans, safe integers, well-formed strings, arrays, and
 * plain objects. Anything else throws, so a float, a lone surrogate, or an
 * `undefined` can never introduce platform-dependent bytes.
 */
export class CanonicalJsonError extends Error {
  override readonly name = 'CanonicalJsonError';
}

/** Order by UTF-16 code units, as RFC 8785 requires. Never locale-aware. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalJsonError(`${path}: only safe integers are canonical, received ${value}.`);
  }
  return Object.is(value, -0) ? '0' : String(value);
}

function serializeString(value: string, path: string): string {
  // In Unicode mode a surrogate pair is one code point, so this matches only
  // unpaired surrogates, which I-JSON (and therefore RFC 8785) forbids.
  if (/[\uD800-\uDFFF]/u.test(value)) {
    throw new CanonicalJsonError(`${path}: string contains an unpaired surrogate.`);
  }
  return JSON.stringify(value);
}

function isPlainObject(value: object): value is Readonly<Record<string, unknown>> {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function serializeObject(value: Readonly<Record<string, unknown>>, path: string): string {
  const keys = Object.keys(value).sort(compareCodeUnits);
  const members = keys.map(
    (key) => `${serializeString(key, path)}:${serializeValue(value[key], `${path}.${key}`)}`,
  );
  return `{${members.join(',')}}`;
}

function serializeValue(value: unknown, path: string): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value, path);
    case 'string':
      return serializeString(value, path);
    case 'object':
      if (Array.isArray(value)) {
        const items = (value as readonly unknown[]).map((item, index) =>
          serializeValue(item, `${path}[${index}]`),
        );
        return `[${items.join(',')}]`;
      }
      if (isPlainObject(value)) {
        return serializeObject(value, path);
      }
      throw new CanonicalJsonError(`${path}: only plain objects are canonical.`);
    default:
      throw new CanonicalJsonError(`${path}: ${typeof value} has no canonical JSON form.`);
  }
}

/** Serialize a value to its RFC 8785 canonical text, with no trailing newline. */
export function canonicalJson(value: unknown): string {
  return serializeValue(value, '$');
}
