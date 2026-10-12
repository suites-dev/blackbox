export function record(value: unknown, location: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Expected object at ${location}`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function fields(value: unknown, names: readonly string[], location: string) {
  const own = record(value, location);
  if (
    Object.keys(own).some((key) => !names.includes(key)) ||
    names.some((key) => !Object.hasOwn(own, key))
  ) {
    throw new TypeError(`Invalid fields at ${location}`);
  }
  return own;
}

export function text(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Expected non-empty string at ${location}`);
  }
  return value;
}

export function boolean(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Expected boolean at ${location}`);
  }
  return value;
}

export function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  location: string,
): T {
  const match = choices.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new TypeError(`Unsupported value at ${location}`);
  }
  return match;
}

export function items<T>(value: unknown, mapper: (entry: unknown) => T, location: string): T[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected array at ${location}`);
  }
  return value.map(mapper);
}
