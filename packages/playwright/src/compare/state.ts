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
  for (const [name, side] of [
    ['reference', reference],
    ['head', head],
  ] as const) {
    if (side.state.rejected > 0) {
      // A repeated or malformed report is dropped on ingestion, and the first record wins: the state that was
      // kept may be an earlier read than the one the test meant as final.
      unresolved.push({
        kind: 'state-annotations-rejected',
        detail: `${name}: ${String(side.state.rejected)} state annotation(s) were malformed or repeated and ignored`,
      });
    }
  }
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
