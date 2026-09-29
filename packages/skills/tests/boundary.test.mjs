import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyClosure, proposeBoundary } from '../dist/src/index.js';
import { example } from './support.mjs';

const propose = (graph) => proposeBoundary({ graph, entryIds: ['api'], terminalIds: ['postgres'] });

test('slices the HTTP path and closes mandatory dependencies', () => {
  assert.deepEqual(propose(example().audit.graph), {
    kind: 'candidate', nodeIds: ['api', 'billing', 'postgres'], unresolvedEdgeIds: [], minimality: 'not-established',
  });
});

test('queue slice includes the off-path database prerequisite', () => {
  const { graph } = example('queue').audit;
  const result = proposeBoundary({ graph, entryIds: ['input-queue'], terminalIds: ['output-queue'] });
  assert.equal(result.kind, 'candidate');
  assert.ok(result.nodeIds.includes('postgres'));
});

test('does not include a colocated service just because it shares deployment', () => {
  const { graph } = example().audit;
  graph.nodes.push({ ...graph.nodes[0], id: 'analytics' });
  graph.edges.push({ id: 'co', kind: 'deployment', relation: 'colocated', from: 'api', to: 'analytics', evidenceIds: ['src-1'] });
  assert.ok(!propose(graph).nodeIds.includes('analytics'));
});

test('keeps unresolved prerequisites instead of minimizing them away', () => {
  const { graph } = example().audit;
  graph.edges[2].necessity = 'unknown';
  assert.deepEqual(propose(graph).unresolvedEdgeIds, ['requires-0']);
});

test('dependency cycles terminate and remain closed', () => {
  const { graph } = example().audit;
  graph.edges.push({ ...graph.edges[2], id: 'cycle', from: 'postgres', to: 'api' });
  assert.equal(dependencyClosure(graph, ['postgres']).nodeIds.length, 3);
});

test('rejects an unevidenced terminal route', () => {
  const { graph } = example().audit;
  graph.edges = graph.edges.filter((x) => x.kind !== 'behavioral');
  assert.equal(propose(graph).kind, 'invalid');
});

test('rejects missing graph nodes and empty behavioral seeds', () => {
  const { graph } = example().audit;
  assert.equal(dependencyClosure(graph, ['missing']).kind, 'invalid');
  assert.equal(proposeBoundary({ graph, entryIds: [], terminalIds: ['postgres'] }).kind, 'invalid');
});
