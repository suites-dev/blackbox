import type { EffectContract, EffectConstraint } from '../contract.js';
import type { VerificationConstraint, VerificationContract } from '../verification/model.js';

function adaptConstraint(constraint: EffectConstraint): VerificationConstraint {
  if (constraint.operator === 'before') {
    return { op: 'before', a: constraint.first, b: constraint.second };
  }
  return { op: constraint.operator, n: constraint.count, selector: constraint.selector };
}

/** Public aliases and input ownership have already been resolved by the compiler. */
export function adaptContract(contract: EffectContract): VerificationContract {
  return { schemaVersion: '0.1.0', constraints: contract.constraints.map(adaptConstraint) };
}
