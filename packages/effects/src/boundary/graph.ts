import type { EffectGraph } from '../verification/model.js';
import { reachability, validateGraph } from '../verification/graph.js';
import { observedEffect, relation } from './nodes.js';
import { snapshotJson } from './ownership.js';
import { boolean, choice, fields, items, text } from './values.js';

function scope(value: unknown): EffectGraph['scope'] {
  const input = fields(value, ['id', 'closed'], 'graph.scope');
  return { id: text(input.id, 'scope.id'), closed: boolean(input.closed, 'scope.closed') };
}

function quality(value: unknown): EffectGraph['quality'] {
  const input = fields(
    value,
    ['coverage', 'orderCoverage', 'reasons', 'attestation'],
    'graph.quality',
  );
  return {
    coverage: choice(input.coverage, ['unknown', 'partial', 'complete'], 'quality.coverage'),
    orderCoverage: choice(
      input.orderCoverage,
      ['unknown', 'partial', 'complete'],
      'quality.orderCoverage',
    ),
    reasons: items(input.reasons, (reason) => text(reason, 'quality.reasons'), 'quality.reasons'),
    attestation: text(input.attestation, 'quality.attestation'),
  };
}

/** Completeness metadata is the caller's attestation, not authenticated evidence. */
export function snapshotGraph(value: unknown): EffectGraph {
  const input = fields(
    snapshotJson(value),
    ['schemaVersion', 'scope', 'quality', 'effects', 'relations'],
    'graph',
  );
  if (input.schemaVersion !== '0.1.1') {
    throw new TypeError('Unsupported EffectGraph schemaVersion');
  }
  const graph = {
    schemaVersion: '0.1.1',
    scope: scope(input.scope),
    quality: quality(input.quality),
    effects: items(input.effects, observedEffect, 'graph.effects'),
    relations: items(input.relations, relation, 'graph.relations'),
  } satisfies EffectGraph;
  validateGraph(graph);
  reachability(graph);
  return graph;
}
