import type { Graph } from '../model/graph.js';

export type ClosureResult =
  | Readonly<{ kind: 'invalid'; reasons: readonly string[] }>
  | Readonly<{
      kind: 'candidate';
      nodeIds: readonly string[];
      unresolvedEdgeIds: readonly string[];
      minimality: 'not-established';
    }>;

function walk(
  graph: Graph,
  seeds: readonly string[],
  direction: 'forward' | 'backward',
): Set<string> {
  const visited = new Set(seeds);
  const pending = [...seeds];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const edge of graph.edges) {
      if (edge.kind !== 'behavioral') {
        continue;
      }
      const from = direction === 'forward' ? edge.from : edge.to;
      const to = direction === 'forward' ? edge.to : edge.from;
      if (from === current && !visited.has(to)) {
        visited.add(to);
        pending.push(to);
      }
    }
  }
  return visited;
}

/** Conservative closure retains conditional and unknown prerequisites until resolved. */
export function dependencyClosure(graph: Graph, seeds: readonly string[]): ClosureResult {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const missing = [...seeds, ...graph.edges.flatMap((edge) => [edge.from, edge.to])].filter(
    (id) => !ids.has(id),
  );
  if (ids.size !== graph.nodes.length || missing.length > 0) {
    return { kind: 'invalid', reasons: ['Graph identities or seed references are invalid.'] };
  }
  const selected = new Set(seeds);
  const unresolved = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (edge.kind !== 'requires' || !selected.has(edge.from)) {
        continue;
      }
      if (edge.necessity !== 'mandatory') {
        unresolved.add(edge.id);
      }
      if (!selected.has(edge.to)) {
        selected.add(edge.to);
        changed = true;
      }
    }
  }
  return {
    kind: 'candidate',
    nodeIds: [...selected].sort(),
    unresolvedEdgeIds: [...unresolved].sort(),
    minimality: 'not-established',
  };
}

/** A bidirectional slice is a proposal, not a proof of behavioral equivalence. */
export function proposeBoundary(
  input: Readonly<{
    graph: Graph;
    entryIds: readonly string[];
    terminalIds: readonly string[];
  }>,
): ClosureResult {
  if (input.entryIds.length === 0 || input.terminalIds.length === 0) {
    return {
      kind: 'invalid',
      reasons: ['Explicit behavioral entry and terminal nodes are required.'],
    };
  }
  const forward = walk(input.graph, input.entryIds, 'forward');
  if (input.terminalIds.some((id) => !forward.has(id))) {
    return {
      kind: 'invalid',
      reasons: ['A terminal node has no evidenced behavioral path from an entry.'],
    };
  }
  const backward = walk(input.graph, input.terminalIds, 'backward');
  const slice = [...forward].filter((id) => backward.has(id));
  return dependencyClosure(input.graph, [...slice, ...input.entryIds, ...input.terminalIds]);
}
