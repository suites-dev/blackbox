import { observedEffects } from '../envelope/effects.js';
import type { AtMostClaim, ClaimFinding, ComparisonSide } from './types.js';

function matching(side: ComparisonSide, claim: AtMostClaim): readonly string[] {
  if (side.snapshot === null) {
    return [];
  }
  const { selector } = claim;
  return observedEffects(side.snapshot)
    .filter(
      (effect) =>
        effect.infrastructure === null &&
        effect.purposes.includes('stimulus') &&
        effect.kind === selector.kind &&
        effect.actor === selector.actor &&
        effect.side === selector.side &&
        effect.operation === selector.operation,
    )
    .flatMap(({ spanRefs }) => spanRefs);
}

function finding(
  claim: AtMostClaim,
  which: ClaimFinding['side'],
  side: ComparisonSide,
): ClaimFinding {
  const refs = [...new Set(matching(side, claim))].sort();
  const record =
    claim.stateSubject === null
      ? undefined
      : side.envelope.state.records.find(({ subject }) => subject === claim.stateSubject);
  const base = { claim: claim.id, side: which, spans: refs.length, evidence: refs };
  if (side.snapshot === null && record === undefined) {
    return {
      ...base,
      status: 'unevaluable',
      basis: 'none',
      distinctRecords: null,
      businessOperationsEstablished: false,
      reason: 'no observations and no reported state for this attempt',
    };
  }
  if (record !== undefined) {
    const established = true;
    if (record.distinct > claim.n) {
      return {
        ...base,
        status: 'refuted',
        basis: 'state',
        distinctRecords: record.distinct,
        businessOperationsEstablished: established,
        reason: `${String(record.distinct)} distinct ${record.subject} records exist; at most ${String(claim.n)} allowed`,
      };
    }
    if (refs.length > claim.n) {
      return {
        ...base,
        status: 'suspect',
        basis: 'state',
        distinctRecords: record.distinct,
        businessOperationsEstablished: established,
        reason: `${String(refs.length)} spans exceed ${String(claim.n)} but state holds ${String(record.distinct)} distinct records: a retry or a duplicated span, not a second operation`,
      };
    }
    return {
      ...base,
      status: 'not-refuted',
      basis: 'state',
      distinctRecords: record.distinct,
      businessOperationsEstablished: established,
      reason: 'state shows no excess; says nothing about operations the capture may have missed',
    };
  }
  if (refs.length > claim.n) {
    return {
      ...base,
      status: 'span-excess',
      basis: 'spans',
      distinctRecords: null,
      businessOperationsEstablished: false,
      reason: `${String(refs.length)} distinct spans exceed ${String(claim.n)}; spans are not business operations and no state was reported to establish them`,
    };
  }
  return {
    ...base,
    status: 'not-refuted',
    basis: 'spans',
    distinctRecords: null,
    businessOperationsEstablished: false,
    reason: 'no excess witnessed; an incomplete capture cannot show there was none',
  };
}

/**
 * Explicit `atMost` claims, evaluated on each side independently of the comparison. A violation witnessed
 * through authoritative state stands even when other telemetry is missing; spans alone only ever show an excess
 * of spans.
 */
export function evaluateClaims(
  claims: readonly AtMostClaim[],
  reference: ComparisonSide,
  head: ComparisonSide,
): readonly ClaimFinding[] {
  return [...claims]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .flatMap((claim) => [finding(claim, 'reference', reference), finding(claim, 'head', head)]);
}
