import type { EffectScalar } from '@suites/blackbox-effects';

import type { ObservationExcerpt } from './artifact-types.js';

const semanticFields = new Set([
  'db.collection.name',
  'db.name',
  'db.namespace',
  'db.operation',
  'db.operation.name',
  'db.sql.table',
  'db.system',
  'db.system.name',
  'http.method',
  'http.request.method',
  'http.route',
  'messaging.destination',
  'messaging.destination.name',
  'messaging.operation',
  'messaging.operation.type',
  'rpc.method',
  'rpc.service',
]);

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function scalar(value: unknown): EffectScalar | null {
  if (!record(value)) {
    return null;
  }
  for (const key of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) {
    const candidate = value[key];
    if (
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean'
    ) {
      return candidate;
    }
  }
  return null;
}

function attributes(value: unknown): ReadonlyMap<string, EffectScalar> {
  const result = new Map<string, EffectScalar>();
  for (const attribute of array(value)) {
    if (!record(attribute) || typeof attribute.key !== 'string') {
      continue;
    }
    const content = scalar(attribute.value);
    if (content !== null) {
      result.set(attribute.key, content);
    }
  }
  return result;
}

function excerpt(input: {
  readonly resource: Readonly<Record<string, unknown>>;
  readonly span: Readonly<Record<string, unknown>>;
}): ObservationExcerpt | null {
  if (typeof input.span.traceId !== 'string' || typeof input.span.spanId !== 'string') {
    return null;
  }
  const spanAttributes = attributes(input.span.attributes);
  const resourceAttributes = attributes(input.resource.attributes);
  const service = resourceAttributes.get('service.name');
  const status = record(input.span.status) ? input.span.status.code : null;
  return {
    traceId: input.span.traceId,
    spanId: input.span.spanId,
    service: typeof service === 'string' ? service : 'unknown',
    kind:
      typeof input.span.kind === 'string' || typeof input.span.kind === 'number'
        ? String(input.span.kind)
        : 'unknown',
    status: typeof status === 'string' || typeof status === 'number' ? String(status) : 'unknown',
    fields: [...spanAttributes]
      .filter(([key]) => semanticFields.has(key))
      .map(([key, value]) => ({ key, value })),
  };
}

function visitPayload(
  payload: unknown,
  visit: (observation: ObservationExcerpt) => void,
): void {
  if (!record(payload)) {
    return;
  }
  for (const resourceSpans of array(payload.resourceSpans)) {
    if (!record(resourceSpans) || !record(resourceSpans.resource)) {
      continue;
    }
    for (const scopeSpans of array(resourceSpans.scopeSpans)) {
      if (!record(scopeSpans)) {
        continue;
      }
      for (const span of array(scopeSpans.spans)) {
        if (!record(span)) {
          continue;
        }
        const candidate = excerpt({ resource: resourceSpans.resource, span });
        if (candidate !== null) {
          visit(candidate);
        }
      }
    }
  }
}

export function observationExcerpts(
  payloads: readonly unknown[],
  limit: number,
): { readonly excerpts: readonly ObservationExcerpt[]; readonly total: number } {
  const excerpts: ObservationExcerpt[] = [];
  let total = 0;
  for (const payload of payloads) {
    visitPayload(payload, (candidate) => {
      total++;
      if (excerpts.length < limit) {
        excerpts.push(candidate);
      }
    });
  }
  return { excerpts, total };
}
