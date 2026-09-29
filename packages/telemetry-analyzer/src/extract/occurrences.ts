import { compareCodeUnits } from '../canonical/jcs.js';
import type { ConflictingDuplicateDelivery } from '../model/effect-set.js';
import type { SpanRow } from './otlp-rows.js';

/**
 * One distinct span. Its identity is (service, traceId, spanId): an exporter
 * retry of the same span merges into one occurrence, while two real calls
 * always carry distinct span ids and stay two occurrences however similar.
 */
export interface Occurrence {
  /** The content of the earliest delivery. */
  readonly row: SpanRow;
  /** Every fragment sequence that delivered this span, ascending and unique. */
  readonly deliveries: readonly number[];
}

export function occurrenceKey(row: {
  readonly service: string;
  readonly traceId: string;
  readonly spanId: string;
}): string {
  return JSON.stringify([row.service, row.traceId, row.spanId]);
}

/** Total order: service, then trace id, then span id, by UTF-16 code units. */
export function compareOccurrenceRefs(
  left: { readonly service: string; readonly traceId: string; readonly spanId: string },
  right: { readonly service: string; readonly traceId: string; readonly spanId: string },
): number {
  return (
    compareCodeUnits(left.service, right.service) ||
    compareCodeUnits(left.traceId, right.traceId) ||
    compareCodeUnits(left.spanId, right.spanId)
  );
}

interface Accumulator {
  readonly row: SpanRow;
  readonly deliveries: Set<number>;
  conflicting: boolean;
}

/**
 * Merge duplicate deliveries of the same span. A duplicate whose content
 * differs is not silently resolved: the earliest delivery is kept and the
 * conflict is reported as a limitation.
 */
export function toOccurrences(rows: readonly SpanRow[]): {
  readonly occurrences: readonly Occurrence[];
  readonly limitations: readonly ConflictingDuplicateDelivery[];
} {
  const byKey = new Map<string, Accumulator>();
  const ordered = [...rows].sort((left, right) => left.sequence - right.sequence);
  for (const row of ordered) {
    const key = occurrenceKey(row);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { row, deliveries: new Set([row.sequence]), conflicting: false });
    } else {
      existing.deliveries.add(row.sequence);
      existing.conflicting ||= existing.row.content !== row.content;
    }
  }
  const merged = [...byKey.values()].sort((left, right) =>
    compareOccurrenceRefs(left.row, right.row),
  );
  const occurrences = merged.map((entry) => ({
    row: entry.row,
    deliveries: [...entry.deliveries].sort((left, right) => left - right),
  }));
  const limitations = merged
    .filter((entry) => entry.conflicting)
    .map(
      (entry) =>
        ({
          kind: 'conflicting-duplicate-delivery',
          service: entry.row.service,
          traceId: entry.row.traceId,
          spanId: entry.row.spanId,
          deliveries: [...entry.deliveries].sort((left, right) => left - right),
          retained: entry.row.sequence,
        }) satisfies ConflictingDuplicateDelivery,
    );
  return { occurrences, limitations };
}
