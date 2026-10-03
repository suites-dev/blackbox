import type { EffectGraph } from '../verification/model.js';
import { projectEffect } from './effects.js';
import { collectRecords } from './records.js';
import { projectRelations } from './relations.js';

/** Production projection: open capture, structured operations, no lab annotations. */
export function projectObservations(
  payloads: readonly unknown[],
  scopeId: string,
  diagnostics: readonly string[] = [],
): EffectGraph {
  const raw = collectRecords(payloads);
  const effects = [...raw].map(([id, item]) => projectEffect(id, item));
  const projected = projectRelations(raw);
  const reasons = [...diagnostics, ...projected.reasons, 'no-harness-completeness-attestation'];
  if (effects.some((effect) => effect.kind === 'unknown')) {
    reasons.push('unclassified-operation');
  }
  return {
    schemaVersion: '0.1.1',
    scope: { id: scopeId, closed: false },
    quality: {
      coverage: projected.partialCoverage ? 'partial' : 'unknown',
      orderCoverage: projected.partialOrder ? 'partial' : 'unknown',
      reasons: [...new Set(reasons)],
      attestation: 'none',
    },
    effects,
    relations: projected.relations,
  };
}
