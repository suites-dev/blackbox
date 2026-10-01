import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dependencyClosure, proposeBoundary } from '../index.js';
import type { Graph } from '../model/graph.js';
import { graphExample } from '../test-fixtures/audit.js';

const propose = (graph: Graph) =>
  proposeBoundary({ graph, entryIds: ['api'], terminalIds: ['postgres'] });

test('slices the HTTP path and closes mandatory dependencies', () => {
  assert.deepEqual(propose(graphExample()), {
    kind: 'candidate',
    nodeIds: ['api', 'billing', 'postgres'],
    unresolvedEdgeIds: [],
    minimality: 'not-established',
  });
});

test('queue slice includes the off-path database prerequisite', () => {
  const graph = graphExample('queue');
  const result = proposeBoundary({
    graph,
    entryIds: ['input-queue'],
    terminalIds: ['output-queue'],
  });
  assert.equal(result.kind, 'candidate');
  assert.ok(result.nodeIds.includes('postgres'));
});

test('does not include a colocated service just because it shares deployment', () => {
  const graph = graphExample();
  graph.nodes.push({ ...graph.nodes[0], id: 'analytics' });
  graph.edges.push({
    id: 'co',
    kind: 'deployment',
    relation: 'colocated',
    from: 'api',
    to: 'analytics',
    evidenceIds: ['src-1'],
  });
  const result = propose(graph);
  assert.equal(result.kind, 'candidate');
  assert.ok(!result.nodeIds.includes('analytics'));
});

test('keeps unresolved prerequisites instead of minimizing them away', () => {
  const graph = graphExample();
  const edge = graph.edges[2];
  assert.equal(edge.kind, 'requires');
  edge.necessity = 'unknown';
  const result = propose(graph);
  assert.equal(result.kind, 'candidate');
  assert.deepEqual(result.unresolvedEdgeIds, ['requires-0']);
});

test('dependency cycles terminate and remain closed', () => {
  const graph = graphExample();
  graph.edges.push({ ...graph.edges[2], id: 'cycle', from: 'postgres', to: 'api' });
  const result = dependencyClosure(graph, ['postgres']);
  assert.equal(result.kind, 'candidate');
  assert.equal(result.nodeIds.length, 3);
});

test('rejects an unevidenced terminal route', () => {
  const graph = graphExample();
  graph.edges = graph.edges.filter((x: { kind: string }) => x.kind !== 'behavioral');
  assert.equal(propose(graph).kind, 'invalid');
});

test('rejects missing graph nodes and empty behavioral seeds', () => {
  const graph = graphExample();
  assert.equal(dependencyClosure(graph, ['missing']).kind, 'invalid');
  assert.equal(proposeBoundary({ graph, entryIds: [], terminalIds: ['postgres'] }).kind, 'invalid');
});
