import { expect, it } from 'vitest';
import type { EffectGraph } from '@suites/blackbox-effects';
import { boundedEffectGraph } from './effects.js';

it('marks truncated effects as incomplete and records omitted counts', () => {
  const effect = { id: 'span', kind: 'http', operation: 'POST', target: '/payments', actor: 'api',
    outcome: 'success', attributes: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field-${String(index)}`, index])),
    source: [{ traceId: 'trace', spanId: 'span' }] };
  const graph = { schemaVersion: '0.1.1', scope: { id: 'scope', closed: true },
    quality: { coverage: 'complete', orderCoverage: 'complete', reasons: [], attestation: 'trusted' },
    effects: Array.from({ length: 129 }, () => effect), relations: [] } satisfies EffectGraph;
  const result = boundedEffectGraph(graph);
  expect(result.graph.effects).toHaveLength(128);
  expect(Object.keys(result.graph.effects[0].attributes)).toHaveLength(32);
  expect(result.omitted).toMatchObject({ effects: 1, fields: 129 });
  expect(result.graph.scope.closed).toBe(false);
  expect(result.graph.quality).toMatchObject({ coverage: 'partial', reasons: ['artifact-truncated'] });
});
