import type { EffectRelation } from '../verification/model.js';
import { attributesAt } from './attributes.js';
import type { SpanRecord } from './records.js';
import { array, identifier, record } from './values.js';

interface RelationProjection {
  readonly relations: EffectRelation[];
  readonly reasons: string[];
  partialCoverage: boolean;
  partialOrder: boolean;
}

function addParent(
  id: string,
  item: SpanRecord,
  raw: ReadonlyMap<string, SpanRecord>,
  result: RelationProjection,
): void {
  if (item.span.parentSpanId === undefined || item.span.parentSpanId === '') {
    return;
  }
  const parent = `${item.traceId}:${identifier(item.span.parentSpanId, 16)}`;
  if (raw.has(parent)) {
    result.relations.push({ type: 'parent', from: parent, to: id, evidence: 'otel-parent' });
  } else {
    result.partialCoverage = true;
    result.reasons.push('unresolved-parent');
  }
}

function addLinks(
  id: string,
  item: SpanRecord,
  raw: ReadonlyMap<string, SpanRecord>,
  result: RelationProjection,
): void {
  for (const input of array(item.span.links ?? [], 'links')) {
    const link = record(input, 'link');
    const other = `${identifier(link.traceId, 32)}:${identifier(link.spanId, 16)}`;
    attributesAt(link.attributes, `link from ${id}`, false);
    result.partialOrder = true;
    if (raw.has(other)) {
      result.relations.push({
        type: 'link',
        from: id,
        to: other,
        evidence: 'otel-link-unspecified',
      });
    } else {
      result.partialCoverage = true;
      result.reasons.push('unresolved-link');
    }
  }
}

export function projectRelations(raw: ReadonlyMap<string, SpanRecord>): RelationProjection {
  const result = {
    relations: [],
    reasons: [],
    partialCoverage: false,
    partialOrder: false,
  } satisfies RelationProjection;
  // Annotating accumulators separately keeps their element types concrete.
  const projection: RelationProjection = result;
  for (const [id, item] of raw) {
    addParent(id, item, raw, projection);
    addLinks(id, item, raw, projection);
    if (
      item.span.droppedAttributesCount ||
      item.span.droppedEventsCount ||
      item.span.droppedLinksCount
    ) {
      projection.partialCoverage = true;
      projection.reasons.push('otel-reports-dropped-data');
    }
  }
  return projection;
}
