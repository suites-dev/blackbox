import { compareSides } from '../compare/compare.js';
import type { AtMostClaim, BehavioralDelta, ComparisonSide } from '../compare/types.js';
import { aliasPath, resolveAliases, type BehaviorAlias } from './alias.js';

/**
 * Compares two loaded executions. If their behavior ids differ but a recorded, unambiguous alias connects them, the
 * head is read as the reference's id and the alias steps are listed in the result; otherwise the comparator's own
 * `invalid` stands. No id is ever rewritten in a record.
 */
export function compareThroughAliases(
  reference: ComparisonSide,
  head: ComparisonSide,
  input: { readonly aliases: readonly BehaviorAlias[]; readonly claims: readonly AtMostClaim[] },
): BehavioralDelta {
  const left = reference.envelope.identity.behavior.id;
  const right = head.envelope.identity.behavior.id;
  const path = left === right ? [] : aliasPath(input.aliases, left, right);
  const clean =
    path !== null &&
    [left, right].every((id) => resolveAliases(input.aliases, id).conflicts.length === 0);
  if (!clean || path.length === 0) {
    return compareSides(reference, head, { claims: input.claims });
  }
  const { identity } = head.envelope;
  const view = {
    ...head,
    envelope: {
      ...head.envelope,
      identity: { ...identity, behavior: { ...identity.behavior, id: left } },
    },
  };
  return compareSides(reference, view, { claims: input.claims }, path);
}
