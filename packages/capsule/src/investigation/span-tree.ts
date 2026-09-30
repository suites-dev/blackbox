import type { CapsuleReportSpan } from '../reporting/telemetry-types.js';
import { spanTitle } from './span-title.js';

/** Why a root has no parent in the tree although it names one. */
export type OrphanMark = 'not-yet-observed' | 'not-retained';

export interface SpanTreeNode {
  readonly span: CapsuleReportSpan;
  readonly orphan: OrphanMark | null;
  readonly children: readonly SpanTreeNode[];
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Start time ascending (numerically), a missing start last; then service, then
 * the displayed title, then span ID. Start times are often only millisecond
 * precise, so siblings tie; readable text breaks the tie deterministically and
 * the (random) span ID decides only between spans that print the same.
 */
export function compareSpans(left: CapsuleReportSpan, right: CapsuleReportSpan): number {
  const a = left.startTimeUnixNano;
  const b = right.startTimeUnixNano;
  if (a !== b) {
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    const difference = BigInt(a) - BigInt(b);
    if (difference !== 0n) {
      return difference < 0n ? -1 : 1;
    }
  }
  return (
    compareIds(left.service, right.service) ||
    compareIds(spanTitle(left), spanTitle(right)) ||
    compareIds(left.spanId, right.spanId)
  );
}

/**
 * Removes one parent edge from every cycle: the edge of the cycle member that
 * sorts first. Returns the span IDs whose edge was removed.
 */
function breakCycles(
  ordered: readonly CapsuleReportSpan[],
  byId: ReadonlyMap<string, CapsuleReportSpan>,
  parentOf: Map<string, string>,
): ReadonlySet<string> {
  const broken = new Set<string>();
  const settled = new Set<string>();
  for (const span of ordered) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | undefined = span.spanId;
    while (current !== undefined && !settled.has(current)) {
      if (onPath.has(current)) {
        const members = path.slice(path.indexOf(current)).flatMap((id) => {
          const member = byId.get(id);
          return member === undefined ? [] : [member];
        });
        // The cycle always holds `current`, so it has a first member.
        const first = [...members].sort(compareSpans)[0];
        parentOf.delete(first.spanId);
        broken.add(first.spanId);
        break;
      }
      onPath.add(current);
      path.push(current);
      current = parentOf.get(current);
    }
    for (const id of path) {
      settled.add(id);
    }
  }
  return broken;
}

/**
 * The span tree of ONE trace. A parent edge exists only when a span's
 * parentSpanId equals another retained span's spanId; start-time order never
 * creates an edge. `activitySpanIds` are the context span IDs of activities
 * that own this trace: those spans stand for the activity itself, so they are
 * left out and their children become roots. A root whose named parent is
 * absent (or whose edge closed a cycle) is an orphan: `not-yet-observed`
 * while observation is provisional, `not-retained` once it is final.
 */
export function buildSpanTree(input: {
  readonly spans: readonly CapsuleReportSpan[];
  readonly activitySpanIds: ReadonlySet<string>;
  readonly provisional: boolean;
}): readonly SpanTreeNode[] {
  const retained = [
    ...new Map(
      input.spans
        .filter((span) => !input.activitySpanIds.has(span.spanId))
        .map((span) => [span.spanId, span]),
    ).values(),
  ].sort(compareSpans);
  const byId = new Map(retained.map((span) => [span.spanId, span]));
  const parentOf = new Map<string, string>();
  for (const span of retained) {
    if (span.parentSpanId !== null && byId.has(span.parentSpanId)) {
      parentOf.set(span.spanId, span.parentSpanId);
    }
  }
  const broken = breakCycles(retained, byId, parentOf);
  const mark: OrphanMark = input.provisional ? 'not-yet-observed' : 'not-retained';
  const orphan = (span: CapsuleReportSpan): OrphanMark | null => {
    if (broken.has(span.spanId)) {
      return mark;
    }
    const parent = span.parentSpanId;
    return parent === null || input.activitySpanIds.has(parent) ? null : mark;
  };
  // Built without recursion, so a trace of any depth cannot overflow the stack.
  // Children arrive already ordered: `retained` is sorted and edges are
  // appended in that order.
  const children = new Map<string, SpanTreeNode[]>();
  const nodes = retained.map((span) => {
    const own: SpanTreeNode[] = [];
    children.set(span.spanId, own);
    return { span, orphan: parentOf.has(span.spanId) ? null : orphan(span), children: own };
  });
  const roots: SpanTreeNode[] = [];
  for (const node of nodes) {
    const parent = parentOf.get(node.span.spanId);
    const siblings = parent === undefined ? undefined : children.get(parent);
    if (siblings === undefined) {
      roots.push(node);
    } else {
      siblings.push(node);
    }
  }
  return roots;
}

/** Depth-first (pre-order) walk in tree order, with each node's depth. */
export function walkSpanTree(
  roots: readonly SpanTreeNode[],
): readonly { readonly node: SpanTreeNode; readonly depth: number }[] {
  const out: { node: SpanTreeNode; depth: number }[] = [];
  const stack = [...roots].reverse().map((node) => ({ node, depth: 0 }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    out.push(item);
    const depth = item.depth + 1;
    for (const child of [...item.node.children].reverse()) {
      stack.push({ node: child, depth });
    }
  }
  return out;
}
