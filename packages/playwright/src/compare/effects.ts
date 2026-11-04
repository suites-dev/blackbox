import { observedEffects, type ObservedEffect } from '../envelope/effects.js';
import type {
  ComparableEnvelope,
  ComparisonSide,
  CoverageDelta,
  EffectDelta,
  EffectKey,
  InfrastructureEntry,
  OutcomeCount,
} from './types.js';

interface Group {
  readonly key: EffectKey;
  readonly count: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly refs: readonly string[];
}

function keyOf(effect: ObservedEffect): EffectKey {
  return {
    kind: effect.kind,
    actor: effect.actor,
    side: effect.side,
    operation: effect.operation,
    target: effect.target,
  };
}

const text = (key: EffectKey): string =>
  JSON.stringify([key.kind, key.actor, key.side, key.operation, key.target]);

/**
 * Application observations only: the effects of the stimulus activities that are not on the infrastructure
 * allowlist. A span is never merged with another because the two look alike; each is one identity.
 */
function business(side: ComparisonSide): ReadonlyMap<string, Group> {
  const groups = new Map<string, Group>();
  if (side.snapshot === null) {
    return groups;
  }
  for (const effect of observedEffects(side.snapshot)) {
    if (effect.infrastructure !== null || !effect.purposes.includes('stimulus')) {
      continue;
    }
    const key = keyOf(effect);
    const known = groups.get(text(key));
    const outcomes = { ...(known === undefined ? {} : known.outcomes) };
    outcomes[effect.outcome] = (outcomes[effect.outcome] ?? 0) + effect.count;
    groups.set(text(key), {
      key,
      count: (known === undefined ? 0 : known.count) + effect.count,
      outcomes,
      refs: [...(known === undefined ? [] : known.refs), ...effect.spanRefs].sort(),
    });
  }
  return groups;
}

function counted(group: Group | undefined): OutcomeCount | null {
  return group === undefined ? null : { count: group.count, outcomes: group.outcomes };
}

const sameOutcomes = (a: Group, b: Group): boolean =>
  JSON.stringify(Object.entries(a.outcomes).sort()) ===
  JSON.stringify(Object.entries(b.outcomes).sort());

function completeness(envelope: ComparableEnvelope): boolean {
  return envelope.observed.completeness.status === 'complete';
}

function inference(
  change: EffectDelta['change'],
  reference: boolean,
  head: boolean,
): EffectDelta['inference'] {
  if (reference && head) {
    return 'definite';
  }
  if (change === 'newly-observed') {
    return reference ? 'definite' : head ? 'undetermined' : 'witnessed';
  }
  if (change === 'absent' || change === 'not-observed') {
    return head ? 'definite' : 'undetermined';
  }
  return 'undetermined';
}

function change(
  r: Group | undefined,
  h: Group | undefined,
  headComplete: boolean,
): EffectDelta['change'] | null {
  if (r === undefined && h === undefined) {
    return null;
  }
  if (r === undefined) {
    return 'newly-observed';
  }
  if (h === undefined) {
    return headComplete ? 'absent' : 'not-observed';
  }
  if (r.count === h.count) {
    return sameOutcomes(r, h) ? null : 'outcome-differs';
  }
  return 'count-differs';
}

function participantStatus(envelope: ComparableEnvelope, actor: string): string {
  const found = envelope.observed.coverage.participants.find(({ service }) => service === actor);
  return found === undefined ? 'unlisted' : found.status;
}

/** A missing observation is explained by coverage when the side that lacks it did not observe that participant. */
function cause(
  delta: EffectDelta,
  reference: ComparableEnvelope,
  head: ComparableEnvelope,
): string | null {
  const actor = delta.effect.actor;
  if (delta.change === 'not-observed' || delta.change === 'absent') {
    const status = participantStatus(head, actor);
    return status === 'observed' || status === 'unlisted'
      ? null
      : `head participant ${actor}: ${status}`;
  }
  if (delta.change === 'newly-observed') {
    const status = participantStatus(reference, actor);
    return status === 'observed' || status === 'unlisted'
      ? null
      : `reference participant ${actor}: ${status}`;
  }
  return null;
}

export function diffEffects(
  reference: ComparisonSide,
  head: ComparisonSide,
): { readonly drift: readonly EffectDelta[]; readonly coverage: readonly CoverageDelta[] } {
  const left = business(reference);
  const right = business(head);
  const drift: EffectDelta[] = [];
  const coverage: CoverageDelta[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const r = left.get(id);
    const h = right.get(id);
    const kind = change(r, h, completeness(head.envelope));
    if (kind === null) {
      continue;
    }
    const source = r ?? h;
    if (source === undefined) {
      continue;
    }
    const delta = {
      change: kind,
      effect: source.key,
      reference: counted(r),
      head: counted(h),
      inference: inference(kind, completeness(reference.envelope), completeness(head.envelope)),
      evidence: { reference: r === undefined ? [] : r.refs, head: h === undefined ? [] : h.refs },
    } satisfies EffectDelta;
    const why = cause(delta, reference.envelope, head.envelope);
    if (why === null) {
      drift.push(delta);
    } else {
      coverage.push({ ...delta, cause: why });
    }
  }
  return { drift, coverage };
}

interface Counted {
  readonly actor: string;
  readonly class: string;
  readonly count: number;
  readonly refs: readonly string[];
}

/** Connection management is kept in view as a diagnostic and never counted as application drift. */
export function diffInfrastructure(
  reference: ComparisonSide,
  head: ComparisonSide,
): readonly InfrastructureEntry[] {
  const collect = (side: ComparisonSide): Map<string, Counted> => {
    const found = new Map<string, Counted>();
    for (const effect of side.snapshot === null ? [] : observedEffects(side.snapshot)) {
      if (effect.infrastructure === null) {
        continue;
      }
      const id = `${effect.actor}\0${effect.infrastructure}`;
      const known = found.get(id);
      found.set(id, {
        actor: effect.actor,
        class: effect.infrastructure,
        count: (known === undefined ? 0 : known.count) + effect.count,
        refs: [...(known === undefined ? [] : known.refs), ...effect.spanRefs].sort(),
      });
    }
    return found;
  };
  const left = collect(reference);
  const right = collect(head);
  return [...new Set([...left.keys(), ...right.keys()])].sort().map((id) => {
    const r = left.get(id);
    const h = right.get(id);
    const source = r ?? h;
    return {
      actor: source === undefined ? '' : source.actor,
      class: source === undefined ? '' : source.class,
      reference: r === undefined ? 0 : r.count,
      head: h === undefined ? 0 : h.count,
      evidence: { reference: r === undefined ? [] : r.refs, head: h === undefined ? [] : h.refs },
    };
  });
}
