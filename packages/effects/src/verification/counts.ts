import type { EffectCountOperator, EffectSelector } from '../contract.js';
import type {
  EffectSelection,
  VerificationContext,
  VerificationFinding,
  VerificationStatus,
} from './model.js';
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
  return verifySelectedCount(
    select(context.graph, constraint.selector),
    context.closed,
    constraint,
  );
}

/** Shared interval semantics for contracts and immutable emission recorders. */
export function verifySelectedCount(
  selected: EffectSelection,
  closed: boolean,
  constraint: { readonly op: EffectCountOperator; readonly n: number },
): VerificationFinding {
  if (!Number.isSafeInteger(constraint.n) || constraint.n < 0) {
    throw new TypeError('Invalid count');
  }
  const lower = selected.definite.length;
  const upper = closed ? lower + selected.possible.length : Infinity;
  const status = countStatus(constraint.op, constraint.n, lower, upper);
  const interval = `${constraint.op} ${constraint.n}; observed lower=${lower}, upper=${closed ? upper : 'unbounded'}`;
  return {
    status,
    reason:
      !closed && status === 'inconclusive' && constraint.op !== 'atLeast'
        ? `${interval}. Proving an upper bound requires a closed scope with complete effect coverage.`
        : interval,
    evidence: selected.definite.map((effect) => effect.id),
  };
}
