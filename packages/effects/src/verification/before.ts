import type { EffectSelector } from '../contract.js';
import type { EffectSelection, VerificationContext, VerificationFinding } from './model.js';
import { select } from './selectors.js';

type PairEvidence =
  | { readonly kind: 'established' }
  | { readonly kind: 'missing' | 'contradiction'; readonly evidence: readonly string[] };

function inspectPairs(
  first: EffectSelection,
  second: EffectSelection,
  closure: VerificationContext['closure'],
): PairEvidence {
  let missing: readonly string[] | null = null;
  for (const left of first.definite) {
    for (const right of second.definite) {
      if (left.id === right.id || (closure.get(right.id) ?? new Set()).has(left.id)) {
        return { kind: 'contradiction', evidence: [left.id, right.id] };
      }
      // Continue scanning: an unknown pair cannot erase a later contradiction.
      if (missing === null && !(closure.get(left.id) ?? new Set()).has(right.id)) {
        missing = [left.id, right.id];
      }
    }
  }
  return missing === null ? { kind: 'established' } : { kind: 'missing', evidence: missing };
}

function absent(selection: EffectSelection): boolean {
  return selection.definite.length === 0 && selection.possible.length === 0;
}

export function verifyBefore(
  context: VerificationContext,
  constraint: { readonly a: EffectSelector; readonly b: EffectSelector },
): VerificationFinding {
  const first = select(context.graph, constraint.a);
  const second = select(context.graph, constraint.b);
  const evidence = [...first.definite, ...second.definite].map((effect) => effect.id);
  if (absent(first) || absent(second)) {
    return {
      status: context.closed ? 'fail' : 'inconclusive',
      reason: 'before requires both endpoints',
      evidence,
    };
  }
  const pairs = inspectPairs(first, second, context.closure);
  if (pairs.kind === 'contradiction') {
    return {
      status: 'fail',
      reason: 'Self-ordering or reverse causal witness',
      evidence: pairs.evidence,
    };
  }
  if (pairs.kind === 'missing') {
    return {
      status: context.fullOrder ? 'fail' : 'inconclusive',
      reason: 'Required happens-before relation not established',
      evidence: pairs.evidence,
    };
  }
  if (
    !context.closed ||
    first.possible.length > 0 ||
    second.possible.length > 0 ||
    first.definite.length === 0 ||
    second.definite.length === 0
  ) {
    return { status: 'inconclusive', reason: 'Open scope or unresolved selectors', evidence };
  }
  return { status: 'pass', reason: 'Every matching A precedes every matching B', evidence };
}
