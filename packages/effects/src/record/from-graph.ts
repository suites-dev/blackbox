import type { EffectGraph } from '../verification/model.js';
import { createEffectsRecord } from './create.js';
import {
  EFFECT_KINDS,
  type Effect,
  type EffectKind,
  type EffectsCompleteness,
  type EffectsRecord,
  type EffectsRecordSource,
} from './types.js';

function recordKind(kind: string): EffectKind {
  return EFFECT_KINDS.find((known) => known === kind) ?? 'unknown';
}

/**
 * The record states completeness once: a scope that is closed with complete coverage is
 * `complete`; anything else is `incomplete` and names why, so a missing effect is never
 * read as "did not happen".
 */
function completenessOf(graph: EffectGraph): EffectsCompleteness {
  if (graph.quality.coverage === 'complete' && graph.scope.closed) {
    return { status: 'complete' };
  }
  const why = [
    graph.scope.closed ? '' : 'scope not closed',
    `coverage ${graph.quality.coverage}`,
    ...graph.quality.reasons,
  ].filter((part) => part !== '');
  return { status: 'incomplete', reason: why.join('; ') };
}

/**
 * One record from one projected effect graph. Only what is needed to compare two runs is kept:
 * kind, operation, target and outcome, counted. Actor, attributes and span identities are dropped.
 */
export function createEffectsRecordFromGraph(input: {
  readonly source: EffectsRecordSource;
  readonly graph: EffectGraph;
}): EffectsRecord {
  const effects: Effect[] = input.graph.effects.map((effect) => ({
    kind: recordKind(effect.kind),
    operation: effect.operation,
    target: effect.target,
    outcome: effect.outcome,
    count: 1,
  }));
  return createEffectsRecord({
    source: input.source,
    completeness: completenessOf(input.graph),
    effects,
  });
}
