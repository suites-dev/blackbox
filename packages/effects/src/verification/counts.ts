import type { EffectCountOperator, EffectSelector } from '../contract.js';
import type { VerificationContext, VerificationFinding, VerificationStatus } from './model.js';
import { select } from './selectors.js';

function countStatus(
  operator: EffectCountOperator,
  count: number,
  lower: number,
  upper: number,
): VerificationStatus {
  if (operator === 'exactly') {
    if (lower > count || upper < count) {
      return 'fail';
    }
    return lower === upper && lower === count ? 'pass' : 'inconclusive';
  }
  if (operator === 'atLeast') {
    if (lower >= count) {
      return 'pass';
    }
    return upper < count ? 'fail' : 'inconclusive';
  }
  if (lower > count) {
    return 'fail';
  }
  return upper <= count ? 'pass' : 'inconclusive';
}

export function verifyCount(
  context: VerificationContext,
  constraint: {
    readonly op: EffectCountOperator;
    readonly n: number;
    readonly selector: EffectSelector;
  },
): VerificationFinding {
  if (!Number.isSafeInteger(constraint.n) || constraint.n < 0) {
    throw new TypeError('Invalid count');
  }
  const selected = select(context.graph, constraint.selector);
  const lower = selected.definite.length;
  const upper = context.closed ? lower + selected.possible.length : Infinity;
  return {
    status: countStatus(constraint.op, constraint.n, lower, upper),
    reason: `${constraint.op} ${constraint.n}; observed lower=${lower}, upper=${upper === Infinity ? 'unbounded' : upper}`,
    evidence: selected.definite.map((effect) => effect.id),
  };
}
