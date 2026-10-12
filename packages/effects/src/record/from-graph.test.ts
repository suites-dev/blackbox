import { describe, expect, test } from 'vitest';

import type { EffectGraph, ObservedEffect } from '../verification/model.js';

import { createEffectsRecordFromGraph } from './from-graph.js';
import { serializeEffectsRecord } from './serialize.js';

const source = { kind: 'playwright-attempt', id: 'attempt-1' } as const;

function effect(id: string, fields: Partial<ObservedEffect> = {}): ObservedEffect {
  return {
    id,
    kind: 'db',
    operation: 'INSERT',
    target: 'orders',
    actor: 'order-service',
    outcome: 'unknown',
    attributes: {},
    source: [{ traceId: 'a'.repeat(32), spanId: id.padEnd(16, '0') }],
    ...fields,
  };
}

function graph(
  effects: readonly ObservedEffect[],
  quality: Partial<EffectGraph['quality']> = {},
  closed = true,
): EffectGraph {
  return {
    schemaVersion: '0.1.1',
    scope: { id: 'scope-1', closed },
    quality: {
      coverage: 'complete',
      orderCoverage: 'unknown',
      reasons: [],
      attestation: 'none',
      ...quality,
    },
    effects,
    relations: [],
  };
}

describe('createEffectsRecordFromGraph', () => {
  test('counts equal effects and drops actor, attributes and span identities', () => {
    const record = createEffectsRecordFromGraph({
      source,
      graph: graph([
        effect('01'),
        effect('02'),
        effect('03', { kind: 'http', operation: 'GET', target: '/h' }),
      ]),
    });
    expect(record.effects).toEqual([
      { kind: 'db', operation: 'INSERT', target: 'orders', outcome: 'unknown', count: 2 },
      { kind: 'http', operation: 'GET', target: '/h', outcome: 'unknown', count: 1 },
    ]);
    expect(serializeEffectsRecord(record)).not.toMatch(/order-service|spanId|traceId/u);
  });

  test('is complete only when the scope is closed and the coverage is complete', () => {
    expect(
      createEffectsRecordFromGraph({ source, graph: graph([effect('01')]) }).completeness,
    ).toEqual({
      status: 'complete',
    });
  });

  test.each([
    [
      'partial coverage',
      graph([], { coverage: 'partial', reasons: ['otel-reports-dropped-data'] }),
      'coverage partial; otel-reports-dropped-data',
    ],
    ['unknown coverage', graph([], { coverage: 'unknown' }), 'coverage unknown'],
    ['an open scope', graph([], {}, false), 'scope not closed; coverage complete'],
  ])('is incomplete, and says why, for %s', (_name, input, reason) => {
    const record = createEffectsRecordFromGraph({ source, graph: input });
    expect(record.completeness).toEqual({ status: 'incomplete', reason });
  });

  test('keeps an operation no convention classified as kind unknown, not as another kind', () => {
    const record = createEffectsRecordFromGraph({
      source,
      graph: graph([effect('01', { kind: 'unknown', operation: 'unknown', target: 'unknown' })]),
    });
    expect(record.effects).toEqual([
      { kind: 'unknown', operation: 'unknown', target: 'unknown', outcome: 'unknown', count: 1 },
    ]);
    const odd = createEffectsRecordFromGraph({
      source,
      graph: graph([effect('02', { kind: 'zzz' })]),
    });
    expect(odd.effects.map((item) => item.kind)).toEqual(['unknown']);
  });

  test('gives the same bytes whatever the order the graph lists its effects', () => {
    const a = effect('01');
    const b = effect('02', { kind: 'message', operation: 'send', target: 'orders' });
    const forward = serializeEffectsRecord(
      createEffectsRecordFromGraph({ source, graph: graph([a, b]) }),
    );
    const reversed = serializeEffectsRecord(
      createEffectsRecordFromGraph({ source, graph: graph([b, a]) }),
    );
    expect(reversed).toBe(forward);
  });

  test('a graph with no effects stays an empty record, never a statement of absence', () => {
    const record = createEffectsRecordFromGraph({
      source,
      graph: graph([], { coverage: 'partial' }),
    });
    expect(record.effects).toEqual([]);
    expect(record.completeness.status).toBe('incomplete');
  });
});
