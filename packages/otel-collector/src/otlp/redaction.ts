/** Redacts credential-bearing OTLP values before the collector writes a fragment. */
const credential =
  /(?:^|[._-])(?:authorization|auth|cookie|password|passwd|passphrase|secret|token|credential|api[_-]?key|private[_-]?key)(?:$|[._-])/iu;
const credentialUrl = /([a-z][a-z\d+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/giu;
const identities = new Set(['traceId', 'spanId', 'parentSpanId']);

const isCredential = (name: string): boolean =>
  credential.test(name.replace(/([a-z0-9])([A-Z])/gu, '$1_$2'));

function cleanText(value: string, secrets: readonly string[], redacted: string): string {
  let result = value.replace(credentialUrl, `$1${redacted}@`);
  for (const secret of secrets) {
    result = result.replaceAll(secret, redacted);
  }
  return result;
}

/** Parsed JSON only. Bounds traversal and preserves OTLP structure, including trace identifiers. */
export function redactTraceRequest(value: unknown, secrets: readonly string[]): unknown {
  const selected = [...new Set(secrets.filter((item) => item.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  const redacted =
    ['[REDACTED]', '***', ''].find((candidate) =>
      selected.every((secret) => !candidate.includes(secret)),
    ) ?? '';
  let nodes = 0;
  // eslint-disable-next-line complexity -- each supported JSON kind and unsafe boundary is handled explicitly
  const visit = (item: unknown, depth: number, key: string): unknown => {
    nodes++;
    if (depth > 64 || nodes > 250_000) {
      throw new Error('OTLP redaction bounds exceeded.');
    }
    if (typeof item === 'string') {
      const clean = cleanText(item, selected, redacted);
      if (identities.has(key) && clean !== item) {
        throw new Error('OTLP identity contains protected data.');
      }
      return clean;
    }
    if (Array.isArray(item)) {
      return item.map((child) => visit(child, depth + 1, ''));
    }
    if (item === null || typeof item !== 'object') {
      return item;
    }
    const record = item as Record<string, unknown>;
    const sensitiveAttribute = typeof record.key === 'string' && isCredential(record.key);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [name, child] of Object.entries(record)) {
      const cleanName = cleanText(name, selected, redacted);
      if (cleanName !== name) {
        throw new Error('OTLP field name contains protected data.');
      }
      if (Object.hasOwn(output, cleanName)) {
        throw new Error('OTLP redaction caused a key collision.');
      }
      if ((sensitiveAttribute && name === 'value') || isCredential(name)) {
        // OTLP AnyValue remains well formed even when the original was an array or nested map.
        output[cleanName] =
          sensitiveAttribute && name === 'value' ? { stringValue: redacted } : redacted;
      } else {
        output[cleanName] = visit(child, depth + 1, name);
      }
    }
    return output;
  };
  return visit(value, 0, '');
}
