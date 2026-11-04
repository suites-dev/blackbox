import type { BehavioralDelta, ClaimFinding, ComparabilityCheck } from '../types.js';

export function checkOf(delta: BehavioralDelta, name: string): ComparabilityCheck {
  const found = delta.comparability.checks.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no comparability check named ${name}`);
  }
  return found;
}

export function claimOf(delta: BehavioralDelta, side: 'reference' | 'head'): ClaimFinding {
  const found = delta.verification.claims.find((entry) => entry.side === side);
  if (found === undefined) {
    throw new Error(`no claim finding for the ${side}`);
  }
  return found;
}
