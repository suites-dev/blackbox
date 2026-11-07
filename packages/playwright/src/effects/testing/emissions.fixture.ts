import { createEffectCapture, type EffectGraph, type ObservedEffect } from '@suites/blackbox-effects';

import { createBlackboxEffects } from '../runtime.js';

export function emission(id: string, target = '/payments'): ObservedEffect {
  return { id, kind: 'http', operation: 'POST', target, actor: 'payments', outcome: 'succeeded',
    attributes: { 'http.status': 201 }, source: [{ traceId: '1'.repeat(32), spanId: id.padStart(16, '0') }] };
}

/** Closed graphs are controlled verifier inputs, never claims about production OTLP completeness. */
export function completeGraph(effects: readonly ObservedEffect[]): EffectGraph {
  return { schemaVersion: '0.1.1', scope: { id: 'controlled-scope', closed: true },
    quality: { coverage: 'complete', orderCoverage: 'complete', reasons: [], attestation: 'controlled-test-only' },
    effects, relations: [] };
}

export function recordedEffects(graph: EffectGraph) {
  let sequence = 0;
  return createBlackboxEffects({
    sessionId: 'session-1', executionId: 'attempt-1',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'inconclusive', message: 'Use the recorder in this fixture.' }) },
    capture: () => Promise.resolve({
      capture: createEffectCapture({ graph, identity: {
        sessionId: 'session-1', executionId: 'attempt-1', scopeId: graph.scope.id,
        captureId: `capture-${++sequence}`, activityIds: ['stimulus-1'],
      } }),
      evidence: null,
    }),
  });
}
