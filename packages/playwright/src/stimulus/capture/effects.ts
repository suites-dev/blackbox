import type { EffectGraph } from '@suites/blackbox-effects';
import { evidenceLimits } from '../../effects/evaluation/artifact.js';

/** Preserve the effects model while recording every truncation that reduces this artifact's coverage. */
export function boundedEffectGraph(graph: EffectGraph) {
  const effects = graph.effects.slice(0, evidenceLimits.effects).map((effect) => ({
    ...effect,
    attributes: Object.fromEntries(Object.entries(effect.attributes).slice(0, 32)),
    source: effect.source.slice(0, evidenceLimits.sourcesPerEffect),
  }));
  const omitted = {
    effects: Math.max(0, graph.effects.length - effects.length),
    relations: Math.max(0, graph.relations.length - evidenceLimits.relations),
    fields: graph.effects.reduce((sum, effect) => sum + Math.max(0, Object.keys(effect.attributes).length - 32), 0),
    sources: graph.effects.reduce((sum, effect) => sum + Math.max(0, effect.source.length - evidenceLimits.sourcesPerEffect), 0),
  };
  const incomplete = Object.values(omitted).some((count) => count > 0);
  return { graph: { ...graph, effects, relations: graph.relations.slice(0, evidenceLimits.relations),
    ...(incomplete ? { scope: { ...graph.scope, closed: false },
      quality: { ...graph.quality, coverage: 'partial' as const, reasons: [...graph.quality.reasons, 'artifact-truncated'] } } : {}) }, omitted };
}
