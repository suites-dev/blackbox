export function record(value: unknown, location: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Expected OTLP object at ${location}`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function array(value: unknown, location: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected OTLP array at ${location}`);
  }
  return value;
}

export function identifier(value: unknown, length: number): string {
  if (
    typeof value !== 'string' ||
    value.length !== length ||
    !/^[0-9a-f]+$/i.test(value) ||
    /^0+$/.test(value)
  ) {
    throw new TypeError('Invalid OTLP traceId/spanId');
  }
  return value.toLowerCase();
}

/** Canonical comparison of known OTLP fields, preserving array ordering. */
export function stable(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
