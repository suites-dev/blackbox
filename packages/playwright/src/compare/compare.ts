import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import { digestOf } from '../envelope/index.js';
import { isCount, isObject } from '../envelope/shape/fields.js';
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
  type AliasStep,
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
  const named = (ci: Readonly<Record<string, string>>): string =>
    Object.hasOwn(ci, 'invocation') ? ci.invocation : '';
  return named(left) !== '' && named(left) === named(right) ? 'same' : 'unestablished';
}

/**
 * A final snapshot keeps a bounded number of effects, observations and owners. When anything was cut, the retained
 * part can agree while the omitted part differs, so agreement on it is not agreement.
 */
/** Strings the attachment cut at its display limit: two values with the same first characters look equal. */
function cutStrings(snapshot: FinalSnapshotDocument): number {
  const display: unknown = Reflect.get(snapshot, 'display');
  const count = isObject(display) ? display.truncatedStrings : 0;
  return isCount(count) ? count : 0;
}

function truncationOf(name: string, side: ComparisonSide): readonly UnresolvedItem[] {
  if (side.snapshot === null) {
    return [];
  }
  const omitted =
    side.snapshot.evidence.kind === 'admitted'
      ? Object.entries(side.snapshot.evidence.omitted).filter(([, count]) => count > 0)
      : [];
  const cut = cutStrings(side.snapshot);
  const parts = [
    ...omitted.map(([kind, count]) => `${String(count)} ${kind}`),
    ...(cut > 0 ? [`${String(cut)} strings cut at the display limit`] : []),
  ];
  return parts.length === 0
    ? []
    : [
        {
          kind: 'evidence-truncated',
          detail: `${name}: the final snapshot omitted ${parts.join(', ')}`,
        },
      ];
}

function truncation(reference: ComparisonSide, head: ComparisonSide): readonly UnresolvedItem[] {
  return [...truncationOf('reference', reference), ...truncationOf('head', head)];
}

/** Credential header values are never recorded, so two runs that sent different credentials look the same. */
function credentialsOf(name: string, side: ComparisonSide): readonly UnresolvedItem[] {
  const sent = side.envelope.stimulus.activities.some(({ requests }) =>
    requests.some(({ headers }) => Object.values(headers).includes('secret')),
  );
  return sent
    ? [
        {
          kind: 'stimulus-credentials-unverified',
          detail: `${name}: credential headers were sent; their values are hidden and not compared`,
        },
      ]
    : [];
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
function annotated(comparability: BehavioralDelta['comparability'], aliases: readonly AliasStep[]) {
  if (aliases.length === 0) {
    return comparability;
  }
  return {
    ...comparability,
    checks: comparability.checks.map((entry) =>
      entry.name === 'behavior'
        ? {
            ...entry,
            detail: `${entry.detail} (same behavior through ${String(aliases.length)} recorded alias(es); the ids were not merged)`,
          }
        : entry,
    ),
  };
}

export function compareSides(
  reference: ComparisonSide,
  head: ComparisonSide,
  options: CompareOptions = { claims: [] },
  aliases: readonly AliasStep[] = [],
): BehavioralDelta {
  const comparability = annotated(assessComparability(reference, head), aliases);
  const invalid = comparability.level === 'incomparable';
  const limited = comparability.level === 'limited';
  const effects = invalid ? { drift: [], coverage: [] } : diffEffects(reference, head);
  const state = invalid
    ? { deltas: [], unresolved: [] }
    : diffState(reference.envelope, head.envelope);
  const unresolved = [
    ...limits(comparability.checks),
    ...(invalid ? [] : truncation(reference, head)),
    ...(invalid ? [] : [...credentialsOf('reference', reference), ...credentialsOf('head', head)]),
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
    behaviorAliases: aliases,
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
