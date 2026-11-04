import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';

export function sideOf(code: string): string {
  switch (code) {
    case '1':
      return 'internal';
    case '2':
      return 'server';
    case '3':
      return 'client';
    case '4':
      return 'producer';
    case '5':
      return 'consumer';
    default:
      return 'unknown';
  }
}

/** One counted line of what a snapshot observed, with the evidence it came from. */
export interface ObservedEffect {
  readonly kind: string;
  readonly actor: string;
  readonly side: string;
  readonly operation: string;
  readonly target: string;
  readonly outcome: string;
  readonly purposes: readonly string[];
  /** Connection-management span class when the span is on the infrastructure allowlist. */
  readonly infrastructure: string | null;
  readonly count: number;
  /** `traceId:spanId` of every span counted here. Volatile: never part of a digest. */
  readonly spanRefs: readonly string[];
}

/**
 * The snapshot's effects with the side, purposes and infrastructure class the v0 record drops, as a counted
 * multiset. Every effect is one span identity; spans are never merged because they look alike.
 */
export function observedEffects(snapshot: FinalSnapshotDocument): readonly ObservedEffect[] {
  if (snapshot.evidence.kind !== 'admitted') {
    return [];
  }
  const { evidence } = snapshot;
  const spans = new Map(
    evidence.observations.excerpts.map((item) => [`${item.traceId}:${item.spanId}`, item]),
  );
  const owners = new Map(
    evidence.ownership.map((item) => [
      item.effectId,
      item.observations.flatMap(({ owners: list }) => list.map(({ purpose }) => purpose)),
    ]),
  );
  const grouped = new Map<string, ObservedEffect>();
  for (const effect of evidence.projection.effects) {
    const [source] = effect.source;
    const ref = `${source.traceId}:${source.spanId}`;
    const span = spans.get(ref);
    const side = sideOf(span === undefined ? '' : span.kind);
    const infrastructure = span === undefined ? null : span.infrastructure;
    const purposes = [...new Set(owners.get(effect.id) ?? [])].sort();
    const key = JSON.stringify([
      effect.kind,
      effect.actor,
      side,
      effect.operation,
      effect.target,
      effect.outcome,
      purposes,
      infrastructure,
    ]);
    const known = grouped.get(key);
    grouped.set(key, {
      kind: effect.kind,
      actor: effect.actor,
      side,
      operation: effect.operation,
      target: effect.target,
      outcome: effect.outcome,
      purposes,
      infrastructure,
      count: (known === undefined ? 0 : known.count) + 1,
      spanRefs: [...(known === undefined ? [] : known.spanRefs), ref].sort(),
    });
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, value]) => value);
}

export type DetailedEffect = Omit<ObservedEffect, 'spanRefs'>;

/** The same effects without span identities: what a digest may cover. */
export function detailedEffects(snapshot: FinalSnapshotDocument): readonly DetailedEffect[] {
  return observedEffects(snapshot).map(({ spanRefs: _spanRefs, ...rest }) => rest);
}
