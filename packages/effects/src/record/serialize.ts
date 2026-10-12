import type { EffectsRecord } from './types.js';

/**
 * Stable JSON: fixed key order everywhere, two-space indent and a final newline,
 * so equal records are equal bytes. The record is already rebuilt field by field,
 * so no key order from a caller reaches this point.
 */
export function serializeEffectsRecord(record: EffectsRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
