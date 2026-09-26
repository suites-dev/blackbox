function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldArray(input: {
  readonly record: Record<string, unknown>;
  readonly field: string;
}): readonly unknown[] {
  const value = input.record[input.field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${input.field} must be an array.`);
  }
  return value;
}

function otlpIdBytes(input: {
  readonly value: unknown;
  readonly bytes: number;
  readonly field: string;
}): Buffer {
  const pattern = new RegExp(`^[\\da-f]{${String(input.bytes * 2)}}$`, 'iu');
  if (typeof input.value !== 'string' || !pattern.test(input.value)) {
    throw new Error(
      `${input.field} must be a ${String(input.bytes * 2)}-character hexadecimal string.`,
    );
  }
  return Buffer.from(input.value, 'hex');
}

function validateLink(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('Every span link must be an object.');
  }
  otlpIdBytes({ value: value.traceId, bytes: 16, field: 'link.traceId' });
  otlpIdBytes({ value: value.spanId, bytes: 8, field: 'link.spanId' });
}

function validateSpan(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('Every span must be an object.');
  }
  const traceId = otlpIdBytes({ value: value.traceId, bytes: 16, field: 'span.traceId' });
  const spanId = otlpIdBytes({ value: value.spanId, bytes: 8, field: 'span.spanId' });
  if (traceId.every((byte) => byte === 0)) {
    throw new Error('span.traceId cannot be all zero bytes.');
  }
  if (spanId.every((byte) => byte === 0)) {
    throw new Error('span.spanId cannot be all zero bytes.');
  }
  if (value.parentSpanId !== undefined && value.parentSpanId !== '') {
    otlpIdBytes({ value: value.parentSpanId, bytes: 8, field: 'span.parentSpanId' });
  }
  if (typeof value.name !== 'string') {
    throw new Error('span.name must be a string.');
  }
  for (const link of fieldArray({ record: value, field: 'links' })) {
    validateLink(link);
  }
}

function scopeSpansFor(resourceSpan: unknown): readonly unknown[] {
  if (!isRecord(resourceSpan)) {
    throw new Error('Every resourceSpans entry must be an object.');
  }
  return fieldArray({ record: resourceSpan, field: 'scopeSpans' });
}

function spansFor(scopeSpans: unknown): readonly unknown[] {
  if (!isRecord(scopeSpans)) {
    throw new Error('Every scopeSpans entry must be an object.');
  }
  return fieldArray({ record: scopeSpans, field: 'spans' });
}

export function validateOtlpTraceRequest(value: unknown): number {
  if (!isRecord(value)) {
    throw new Error('The OTLP request body must be a JSON object.');
  }
  const resourceSpans = fieldArray({ record: value, field: 'resourceSpans' });
  let count = 0;
  for (const resourceSpan of resourceSpans) {
    for (const scopeSpans of scopeSpansFor(resourceSpan)) {
      for (const span of spansFor(scopeSpans)) {
        validateSpan(span);
        count += 1;
      }
    }
  }
  return count;
}

function spanTraceHex(span: unknown): string {
  if (!isRecord(span)) {
    throw new Error('Retained span is not an object.');
  }
  return otlpIdBytes({ value: span.traceId, bytes: 16, field: 'span.traceId' }).toString('hex');
}

function filterScope(input: {
  readonly scope: unknown;
  readonly traceId: string;
}): Record<string, unknown> | null {
  if (!isRecord(input.scope)) {
    throw new Error('Retained scopeSpans entry is not an object.');
  }
  const spans = spansFor(input.scope).filter((span) => spanTraceHex(span) === input.traceId);
  return spans.length === 0 ? null : { ...input.scope, spans };
}

function filterResource(input: {
  readonly resource: unknown;
  readonly traceId: string;
}): Record<string, unknown> | null {
  if (!isRecord(input.resource)) {
    throw new Error('Retained resourceSpans entry is not an object.');
  }
  const scopeSpans = scopeSpansFor(input.resource)
    .map((scope) => filterScope({ scope, traceId: input.traceId }))
    .filter((scope): scope is Record<string, unknown> => scope !== null);
  return scopeSpans.length === 0 ? null : { ...input.resource, scopeSpans };
}

export function filterTraceRequest(input: {
  readonly request: unknown;
  readonly traceId: string;
}): Record<string, unknown> | null {
  if (!isRecord(input.request)) {
    throw new Error('Retained OTLP request is not an object.');
  }
  const resourceSpans = fieldArray({ record: input.request, field: 'resourceSpans' })
    .map((resource) => filterResource({ resource, traceId: input.traceId }))
    .filter((resource): resource is Record<string, unknown> => resource !== null);
  return resourceSpans.length === 0 ? null : { ...input.request, resourceSpans };
}

export function traceIdsInRequest(request: unknown): readonly string[] {
  if (!isRecord(request)) {
    throw new Error('Retained OTLP request is not an object.');
  }
  const ids = new Set<string>();
  for (const resource of fieldArray({ record: request, field: 'resourceSpans' })) {
    for (const scope of scopeSpansFor(resource)) {
      for (const span of spansFor(scope)) {
        ids.add(spanTraceHex(span));
      }
    }
  }
  return [...ids].sort();
}

function appendGrouped<T>(grouped: Map<string, T[]>, traceId: string, value: T): void {
  const values = grouped.get(traceId);
  if (values === undefined) {
    grouped.set(traceId, [value]);
  } else {
    values.push(value);
  }
}

function groupedSpans(scope: unknown): ReadonlyMap<string, readonly unknown[]> {
  if (!isRecord(scope)) {
    throw new Error('Retained scopeSpans entry is not an object.');
  }
  const grouped = new Map<string, unknown[]>();
  for (const span of spansFor(scope)) {
    const traceId = spanTraceHex(span);
    appendGrouped(grouped, traceId, span);
  }
  return grouped;
}

function groupedScopes(resource: unknown): ReadonlyMap<string, readonly unknown[]> {
  if (!isRecord(resource)) {
    throw new Error('Retained resourceSpans entry is not an object.');
  }
  const grouped = new Map<string, unknown[]>();
  for (const scope of scopeSpansFor(resource)) {
    if (!isRecord(scope)) {
      throw new Error('Retained scopeSpans entry is not an object.');
    }
    for (const [traceId, spans] of groupedSpans(scope)) {
      const filtered = { ...scope, spans };
      appendGrouped(grouped, traceId, filtered);
    }
  }
  return grouped;
}

export function partitionTraceRequest(
  request: unknown,
): ReadonlyMap<string, Record<string, unknown>> {
  if (!isRecord(request)) {
    throw new Error('Retained OTLP request is not an object.');
  }
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const resource of fieldArray({ record: request, field: 'resourceSpans' })) {
    if (!isRecord(resource)) {
      throw new Error('Retained resourceSpans entry is not an object.');
    }
    for (const [traceId, scopeSpans] of groupedScopes(resource)) {
      const filtered = { ...resource, scopeSpans };
      appendGrouped(grouped, traceId, filtered);
    }
  }
  return new Map(
    [...grouped].map(([traceId, resourceSpans]) => [
      traceId,
      { ...request, resourceSpans },
    ]),
  );
}

function spanActivityId(span: unknown): string | null {
  if (!isRecord(span)) {
    throw new Error('Retained span is not an object.');
  }
  for (const attribute of fieldArray({ record: span, field: 'attributes' })) {
    if (!isRecord(attribute) || attribute.key !== 'blackbox.activity.id') {
      continue;
    }
    const value = attribute.value;
    if (isRecord(value) && typeof value.stringValue === 'string') {
      return value.stringValue;
    }
  }
  return null;
}

function filterScopeByActivity(input: {
  readonly scope: unknown;
  readonly activityId: string;
}): Record<string, unknown> | null {
  if (!isRecord(input.scope)) {
    throw new Error('Retained scopeSpans entry is not an object.');
  }
  const spans = spansFor(input.scope).filter(
    (span) => spanActivityId(span) === input.activityId,
  );
  return spans.length === 0 ? null : { ...input.scope, spans };
}

export function filterActivityRequest(input: {
  readonly request: unknown;
  readonly activityId: string;
}): Record<string, unknown> | null {
  if (!isRecord(input.request)) {
    throw new Error('Retained OTLP request is not an object.');
  }
  const resourceSpans = fieldArray({ record: input.request, field: 'resourceSpans' })
    .map((resource): Record<string, unknown> | null => {
      if (!isRecord(resource)) {
        throw new Error('Retained resourceSpans entry is not an object.');
      }
      const scopeSpans = scopeSpansFor(resource)
        .map((scope) => filterScopeByActivity({ scope, activityId: input.activityId }))
        .filter((scope): scope is Record<string, unknown> => scope !== null);
      return scopeSpans.length === 0 ? null : { ...resource, scopeSpans };
    })
    .filter((resource): resource is Record<string, unknown> => resource !== null);
  return resourceSpans.length === 0 ? null : { ...input.request, resourceSpans };
}
