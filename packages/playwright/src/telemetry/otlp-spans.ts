import type { TraceFragment } from '@suites/blackbox-otel-collector';

import type { BlackboxSpan, BlackboxSpanKind, BlackboxSpanStatus } from '../types.js';

type Fields = Readonly<Record<string, unknown>>;
type AttributeValue = string | number | boolean;

function fields(value: unknown): Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : {};
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const kinds = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'] as const;

/** OTLP/JSON encodes SpanKind as its number or, from some exporters, its enum name. */
function spanKind(value: unknown): BlackboxSpanKind {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < kinds.length) {
    return kinds[value];
  }
  const name = typeof value === 'string' ? value.replace(/^SPAN_KIND_/u, '').toLowerCase() : '';
  return kinds.find((kind) => kind === name) ?? 'unspecified';
}

function spanStatus(value: unknown): BlackboxSpanStatus {
  const code = fields(value).code;
  if (code === 1 || code === 'STATUS_CODE_OK') {
    return 'ok';
  }
  return code === 2 || code === 'STATUS_CODE_ERROR' ? 'error' : 'unset';
}

function attributeValue(value: unknown): AttributeValue | null {
  const encoded = fields(value);
  if (typeof encoded.stringValue === 'string') {
    return encoded.stringValue;
  }
  if (typeof encoded.boolValue === 'boolean') {
    return encoded.boolValue;
  }
  const number = encoded.intValue ?? encoded.doubleValue;
  return typeof number === 'number' || typeof number === 'string' ? Number(number) : null;
}

function attributes(value: unknown): Readonly<Record<string, AttributeValue>> {
  const decoded: Record<string, AttributeValue> = {};
  for (const item of list(value).map(fields)) {
    const key = text(item.key);
    const decodedValue = attributeValue(item.value);
    if (key !== null && decodedValue !== null) {
      decoded[key] = decodedValue;
    }
  }
  return Object.freeze(decoded);
}

/** OTLP/JSON writes 64-bit nanosecond timestamps as decimal strings or numbers. */
function nanos(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function decodeSpan(value: unknown, service: string | null): BlackboxSpan | null {
  const span = fields(value);
  const traceId = text(span.traceId);
  const spanId = text(span.spanId);
  const name = typeof span.name === 'string' ? span.name : null;
  if (traceId === null || spanId === null || name === null) {
    return null;
  }
  return Object.freeze({
    traceId,
    spanId,
    parentSpanId: text(span.parentSpanId),
    service,
    name,
    kind: spanKind(span.kind),
    status: spanStatus(span.status),
    startTimeUnixNano: nanos(span.startTimeUnixNano),
    endTimeUnixNano: nanos(span.endTimeUnixNano),
    attributes: attributes(span.attributes),
  });
}

/** Spans of one OTLP/JSON resource, attributed to its `service.name`. */
function resourceSpans(value: unknown): readonly BlackboxSpan[] {
  const resource = fields(value);
  const service = attributes(fields(resource.resource).attributes)['service.name'];
  return list(resource.scopeSpans).flatMap((scope) =>
    list(fields(scope).spans).flatMap((span) => {
      const decoded = decodeSpan(span, typeof service === 'string' ? service : null);
      return decoded === null ? [] : [decoded];
    }),
  );
}

/** Flatten retained OTLP/JSON trace requests into spans, once per trace and span ID. */
export function decodeSpans(fragments: readonly TraceFragment[]): readonly BlackboxSpan[] {
  const spans = new Map<string, BlackboxSpan>();
  for (const fragment of fragments) {
    for (const span of list(fields(fragment.request).resourceSpans).flatMap(resourceSpans)) {
      spans.set(`${span.traceId}:${span.spanId}`, span);
    }
  }
  return [...spans.values()];
}
