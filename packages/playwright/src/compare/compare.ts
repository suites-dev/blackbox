import { digestOf } from '../envelope/canonical.js';
import { evaluateClaims } from './claims.js';
import { assessComparability } from './comparability.js';
import { diffEffects, diffInfrastructure } from './effects.js';
import { diffState } from './state.js';
import {
  deltaVersion,
  type BehavioralDelta,
  type CompareOptions,
  type ComparisonOutcome,
  type ComparisonSide,
  type ComparableEnvelope,
  type SideVerification,
  type UnresolvedItem,
} from './types.js';

function verification(envelope: ComparableEnvelope): SideVerification {
  return {
    attemptId: envelope.identity.attempt.attemptId,
    retry: envelope.identity.attempt.retry,
    testStatus: envelope.verification.testStatus,
    assertions: envelope.verification.assertions,
  };
}

function association(
  reference: ComparableEnvelope,
  head: ComparableEnvelope,
): BehavioralDelta['association'] {
  const describe = (envelope: ComparableEnvelope) => ({
    commit: envelope.source.commit,
    workingTree: envelope.source.workingTree.state,
    fingerprint: envelope.source.fingerprint,
  });
  const known = reference.source.fingerprint !== null && head.source.fingerprint !== null;
  const relation = !known
    ? 'unknown'
    : reference.source.fingerprint === head.source.fingerprint
      ? 'same-source'
      : 'different-source';
  return {
    level: 1,
    reference: describe(reference),
    head: describe(head),
    relation,
    note: 'The revisions are associated with these observations. This is not evidence that a code change caused any difference.',
  };
}

function invocation(
  reference: ComparableEnvelope,
  head: ComparableEnvelope,
): BehavioralDelta['invocation'] {
  const left = reference.provenance.ci;
  const right = head.provenance.ci;
  return Object.hasOwn(left, 'runId') &&
    left.runId !== '' &&
    left.runId === right.runId &&
    left.runAttempt === right.runAttempt
    ? 'same'
    : 'unestablished';
}

function limits(checks: BehavioralDelta['comparability']['checks']): readonly UnresolvedItem[] {
  return checks
    .filter(({ effect }) => effect === 'limits-conclusions')
    .map(({ name, detail }) => ({
      kind:
        name === 'stimulus'
          ? 'stimulus-unestablished'
          : name === 'evidence'
            ? 'evidence-unavailable'
            : 'measurement-basis-differs',
      detail,
    }));
}

function outcomeOf(input: {
  readonly invalid: boolean;
  readonly limited: boolean;
  readonly drift: number;
  readonly unresolved: number;
}): ComparisonOutcome {
  if (input.invalid) {
    return 'invalid';
  }
  if (input.limited) {
    return 'inconclusive';
  }
  if (input.drift > 0) {
    return 'observed-difference';
  }
  return input.unresolved > 0 ? 'inconclusive' : 'no-observed-difference';
}

/**
 * Compares two attempts of one behavior. Comparability is decided first; only a comparison that is allowed
 * produces drift. The result is never a pass or a fail: contract findings sit beside it, and a missing
 * observation is reported as unresolved, never as absence.
 */
export function compareSides(
  reference: ComparisonSide,
  head: ComparisonSide,
  options: CompareOptions = { claims: [] },
): BehavioralDelta {
  const comparability = assessComparability(reference, head);
  const invalid = comparability.level === 'incomparable';
  const limited = comparability.level === 'limited';
  const effects = invalid ? { drift: [], coverage: [] } : diffEffects(reference, head);
  const state = invalid
    ? { deltas: [], unresolved: [] }
    : diffState(reference.envelope, head.envelope);
  const unresolved = [
    ...limits(comparability.checks),
    ...effects.coverage.map(({ cause, effect, change }) => ({
      kind: 'coverage-explained-difference' as const,
      detail: `${change} ${effect.actor} ${effect.kind} ${effect.operation}: ${cause}`,
    })),
    ...state.unresolved,
  ];
  const body = {
    deltaVersion,
    kind: 'behavioral-delta',
    outcome: outcomeOf({
      invalid,
      limited,
      drift: effects.drift.length + state.deltas.length,
      unresolved: unresolved.length,
    }),
    reference: {
      envelope: reference.envelope.digest,
      attemptId: reference.envelope.identity.attempt.attemptId,
      behavior: reference.envelope.identity.behavior.id,
    },
    head: {
      envelope: head.envelope.digest,
      attemptId: head.envelope.identity.attempt.attemptId,
      behavior: head.envelope.identity.behavior.id,
    },
    comparability,
    drift: { effects: effects.drift, state: state.deltas },
    infrastructure: invalid ? [] : diffInfrastructure(reference, head),
    verification: {
      reference: verification(reference.envelope),
      head: verification(head.envelope),
      claims: evaluateClaims(options.claims, reference, head),
    },
    unresolved,
    coverage: effects.coverage,
    association: association(reference.envelope, head.envelope),
    invocation: invocation(reference.envelope, head.envelope),
  } satisfies Omit<BehavioralDelta, 'digest'>;
  return { ...body, digest: digestOf(body) };
}

/** Each head is compared with the reference on its own: a failed attempt and its retry never merge. */
export function compareAttempts(
  reference: ComparisonSide,
  heads: readonly ComparisonSide[],
  options: CompareOptions = { claims: [] },
): readonly BehavioralDelta[] {
  return heads.map((head) => compareSides(reference, head, options));
}
