import { attributesAt, type Attributes } from './attributes.js';
import { array, identifier, record, stable } from './values.js';

export interface SpanRecord {
  readonly span: Readonly<Record<string, unknown>>;
  readonly traceId: string;
  readonly spanId: string;
  readonly resourceAttributes: Attributes;
  readonly attributes: Attributes;
}

function addSpan(
  raw: Map<string, SpanRecord>,
  input: unknown,
  resourceAttributes: Attributes,
): void {
  const span = record(input, 'span');
  const traceId = identifier(span.traceId, 32);
  const spanId = identifier(span.spanId, 16);
  const id = `${traceId}:${spanId}`;
  const item = {
    span,
    traceId,
    spanId,
    resourceAttributes,
    attributes: attributesAt(span.attributes, `span ${id}`, true),
  };
  const previous = raw.get(id);
  if (previous !== undefined) {
    if (stable(previous) !== stable(item)) {
      throw new TypeError(
        'Conflicting duplicate span records: quarantine instead of arbitrary last-write-wins',
      );
    }
    return;
  }
  raw.set(id, item);
}

function addResource(raw: Map<string, SpanRecord>, input: unknown): void {
  const resource = record(input, 'resourceSpans entry');
  const resourceBody = record(resource.resource ?? {}, 'resource');
  const resourceAttributes = attributesAt(resourceBody.attributes, 'resource attributes', false);
  for (const inputScope of array(resource.scopeSpans ?? [], 'scopeSpans')) {
    const scope = record(inputScope, 'scope');
    for (const span of array(scope.spans ?? [], 'spans')) {
      addSpan(raw, span, resourceAttributes);
    }
  }
}

/** Duplicate arrivals are checked across every selected OTLP fragment. */
export function collectRecords(payloads: readonly unknown[]): ReadonlyMap<string, SpanRecord> {
  const raw = new Map<string, SpanRecord>();
  for (const input of payloads) {
    const payload = record(input, 'ExportTraceServiceRequest');
    for (const resource of array(payload.resourceSpans, 'resourceSpans')) {
      addResource(raw, resource);
    }
  }
  return raw;
}
