import type { EffectGraph } from './model.js';

export function validateGraph(graph: EffectGraph): void {
  const ids = new Set(graph.effects.map((effect) => effect.id));
  if (ids.size !== graph.effects.length) {
    throw new TypeError('Duplicate effect identities must be deduplicated at ingestion');
  }
  for (const edge of graph.relations) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new TypeError('Dangling graph relation; record this in quality instead');
    }
  }
}

function descendants(id: string, adjacency: ReadonlyMap<string, ReadonlySet<string>>) {
  const visited = new Set<string>();
  const stack = [...(adjacency.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) {
      break;
    }
    if (next === id) {
      throw new TypeError('happensBefore must be acyclic');
    }
    if (!visited.has(next)) {
      visited.add(next);
      stack.push(...(adjacency.get(next) ?? []));
    }
  }
  return visited;
}

/** Parentage, links and wall-clock timestamps do not establish happens-before. */
export function reachability(graph: EffectGraph): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map(graph.effects.map((effect) => [effect.id, new Set<string>()]));
  for (const edge of graph.relations) {
    if (edge.type === 'happensBefore') {
      const neighbors = adjacency.get(edge.from);
      if (neighbors === undefined) {
        throw new TypeError('Dangling happens-before source');
      }
      neighbors.add(edge.to);
    }
  }
  return new Map([...adjacency.keys()].map((id) => [id, descendants(id, adjacency)]));
}
