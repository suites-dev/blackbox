import type { EffectGraph, ObservedEffect } from '../model.js';

export function effect(
  id: string,
  operation: string,
  fields: Partial<ObservedEffect> = {},
): ObservedEffect {
  return {
    id,
    kind: 'db',
    operation,
    target: 'orders',
    actor: 'orders',
    outcome: 'unknown',
    attributes: {},
    source: [],
    ...fields,
  };
}

/** Complete graphs here are verifier fixtures, never production capture claims. */
export function graph(
  effects: readonly ObservedEffect[],
  fields: Partial<EffectGraph> = {},
): EffectGraph {
  return {
    schemaVersion: '0.1.1',
    scope: { id: 'fixture', closed: true },
    quality: {
      coverage: 'complete',
      orderCoverage: 'complete',
      attestation: 'internal-test-only',
      reasons: [],
    },
    effects,
    relations: [],
    ...fields,
  };
}

export function edge(from: string, to: string) {
  return { type: 'happensBefore', from, to, evidence: 'internal-test-only' } as const;
}
