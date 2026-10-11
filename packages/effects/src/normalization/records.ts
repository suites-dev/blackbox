import { attributesAt, type Attributes } from './attributes.js';
import { traceRequest } from './otlp.js';
import { array, identifier, record, stable } from './values.js';

export interface SpanRecord {
  readonly span: Readonly<Record<string, unknown>>;
  readonly traceId: string;
  readonly spanId: string;
  readonly resourceAttributes: Attributes;
  readonly attributes: Attributes;
  readonly context: Readonly<Record<string, unknown>>;
}

function addSpan(
  raw: Map<string, SpanRecord>,
  input: unknown,
  resourceAttributes: Attributes,
  context: Readonly<Record<string, unknown>>,
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
    context,
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
    const context = {
      resource: resourceBody,
      resourceSchemaUrl: resource.schemaUrl,
      scope: record(scope.scope ?? {}, 'instrumentation scope'),
      scopeSchemaUrl: scope.schemaUrl,
    };
    for (const span of array(scope.spans ?? [], 'spans')) {
      addSpan(raw, span, resourceAttributes, context);
    }
  }
}

/** Duplicate arrivals are checked across every selected OTLP fragment. */
export function collectRecords(payloads: readonly unknown[]): ReadonlyMap<string, SpanRecord> {
  const raw = new Map<string, SpanRecord>();
  for (const input of payloads) {
    const payload = traceRequest(input);
    for (const resource of array(payload.resourceSpans ?? [], 'resourceSpans')) {
      addResource(raw, resource);
    }
  }
  return raw;
}
