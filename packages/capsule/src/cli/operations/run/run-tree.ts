import type { CapsuleReportSpan, OrphanMark, SpanTreeNode } from '@suites/blackbox-capsule';

import { treeLines } from '../inspection/show-format.js';

/** `run` prints at most this many tree lines; `show` prints every span. */
export const RUN_TREE_MAX_LINES = 40;

/** `db.system.name` is the current semantic-convention name of `db.system`. */
const SYSTEM_KEYS = ['db.system', 'db.system.name', 'messaging.system', 'rpc.system'];

/**
 * The spans `run` prints: server, consumer and producer spans, and client
 * spans that call a database, a message system or an RPC system.
 */
export function isRunTreeSpan(span: CapsuleReportSpan): boolean {
  switch (span.spanKind) {
    case 'server':
    case 'consumer':
    case 'producer':
      return true;
    case 'client':
      return span.attributes.some(
        (attribute) => SYSTEM_KEYS.includes(attribute.key) && String(attribute.value) !== '',
      );
    default:
      return false;
  }
}

interface MutableNode {
  readonly span: CapsuleReportSpan;
  readonly orphan: OrphanMark | null;
  readonly children: MutableNode[];
}

/**
 * The tree with only `run` spans. A kept span hangs under its nearest kept
 * ancestor; with none it becomes a root and keeps the orphan mark of the root
 * it came from. Sibling order is tree order. Built without recursion.
 */
export function filterRunTree(roots: readonly SpanTreeNode[]): readonly SpanTreeNode[] {
  const out: MutableNode[] = [];
  const stack: { node: SpanTreeNode; into: MutableNode[]; orphan: OrphanMark | null }[] = [...roots]
    .reverse()
    .map((node) => ({ node, into: out, orphan: node.orphan }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node } = item;
    let into = item.into;
    let orphan = item.orphan;
    if (isRunTreeSpan(node.span)) {
      const kept = {
        span: node.span,
        orphan: item.into === out ? orphan : null,
        children: [],
      } satisfies MutableNode;
      item.into.push(kept);
      into = kept.children;
      orphan = null;
    }
    for (const child of [...node.children].reverse()) {
      stack.push({ node: child, into, orphan: into === out ? (orphan ?? child.orphan) : null });
    }
  }
  return out;
}

/** Nodes in a tree, counted without formatting anything. */
function countNodes(roots: readonly SpanTreeNode[]): number {
  let count = 0;
  const stack = [...roots];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    count += 1;
    stack.push(...node.children);
  }
  return count;
}

/** How many spans the filtered tree holds: one tree line each. */
export function runTreeSize(roots: readonly SpanTreeNode[]): number {
  return countNodes(filterRunTree(roots));
}

/**
 * The filtered tree lines, at most `max`, then one `… <n> more spans` line.
 * Only the lines shown are formatted: a deep trace's indentation grows with
 * every level, so formatting all of it would cost far more than 40 lines.
 */
export function runTreeLines(
  roots: readonly SpanTreeNode[],
  max: number = RUN_TREE_MAX_LINES,
): readonly string[] {
  const filtered = filterRunTree(roots);
  const total = countNodes(filtered);
  const shown = Math.max(0, Math.min(max, total));
  const lines = treeLines(filtered, shown);
  return total <= max ? lines : [...lines, `… ${String(total - shown)} more spans`];
}
