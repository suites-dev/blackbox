import type { ComparableEnvelope, StateDelta, UnresolvedItem } from './types.js';

/**
 * Reported authoritative state is an exact read, so a difference in it is definite. A subject reported on one
 * side only cannot be compared and stays unresolved.
 */
export function diffState(
  reference: ComparableEnvelope,
  head: ComparableEnvelope,
): { readonly deltas: readonly StateDelta[]; readonly unresolved: readonly UnresolvedItem[] } {
  const deltas: StateDelta[] = [];
  const unresolved: UnresolvedItem[] = [];
  const subjects = new Set(
    [...reference.state.records, ...head.state.records].map(({ subject }) => subject),
  );
  for (const subject of [...subjects].sort()) {
    const r = reference.state.records.find((record) => record.subject === subject);
    const h = head.state.records.find((record) => record.subject === subject);
    if (r === undefined || h === undefined) {
      unresolved.push({
        kind: 'state-reported-on-one-side',
        detail: `${subject}: reported by the ${r === undefined ? 'head' : 'reference'} only`,
      });
    } else if (r.digest !== h.digest) {
      deltas.push({
        subject,
        change:
          r.count === h.count && r.distinct === h.distinct ? 'identities-differ' : 'count-differs',
        reference: { count: r.count, distinct: r.distinct, digest: r.digest },
        head: { count: h.count, distinct: h.distinct, digest: h.digest },
        source: { reference: r.source, head: h.source },
      });
    }
  }
  return { deltas, unresolved };
}
