import type { EffectScalar } from '../contract.js';
import type { EffectRelation, ObservedEffect } from '../verification/model.js';
import { choice, fields, items, record, text } from './values.js';

function source(value: unknown) {
  const input = fields(value, ['traceId', 'spanId'], 'effect source');
  return {
    traceId: text(input.traceId, 'source.traceId'),
    spanId: text(input.spanId, 'source.spanId'),
  };
}

function attributes(value: unknown): Readonly<Record<string, EffectScalar>> {
  const input = record(value, 'effect.attributes');
  const entries: [string, EffectScalar][] = [];
  for (const [key, scalar] of Object.entries(input)) {
    if (
      typeof scalar === 'string' ||
      typeof scalar === 'boolean' ||
      (typeof scalar === 'number' && Number.isFinite(scalar))
    ) {
      entries.push([key, scalar]);
    } else {
      throw new TypeError('Effect attributes must contain finite JSON scalars');
    }
  }
  return Object.fromEntries(entries);
}

export function observedEffect(value: unknown): ObservedEffect {
  const input = fields(
    value,
    ['id', 'kind', 'operation', 'target', 'actor', 'outcome', 'attributes', 'source'],
    'effect',
  );
  return {
    id: text(input.id, 'effect.id'),
    kind: text(input.kind, 'effect.kind'),
    operation: text(input.operation, 'effect.operation'),
    target: text(input.target, 'effect.target'),
    actor: text(input.actor, 'effect.actor'),
    outcome: text(input.outcome, 'effect.outcome'),
    attributes: attributes(input.attributes),
    source: items(input.source, source, 'effect.source'),
  };
}

export function relation(value: unknown): EffectRelation {
  const input = fields(value, ['type', 'from', 'to', 'evidence'], 'relation');
  return {
    type: choice(input.type, ['happensBefore', 'parent', 'link'], 'relation.type'),
    from: text(input.from, 'relation.from'),
    to: text(input.to, 'relation.to'),
    evidence: text(input.evidence, 'relation.evidence'),
  };
}
