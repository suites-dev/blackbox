import type { ObservationCompleteness } from './completeness.js';
import type { OrphanMark, SpanTreeNode } from './span-tree.js';
import { spanFailure, spanResult, spanTitle } from './span-title.js';

/** JSON node of a span tree, as `capsule show --json` prints it. Every span kind is included. */
export interface SpanNodeDocument {
  readonly spanId: string;
  readonly service: string;
  readonly kind: string;
  readonly title: string;
  readonly result: string;
  /** An error span's exception or error type; null when none is known. */
  readonly failure: string | null;
  readonly orphan: OrphanMark | null;
  readonly children: readonly SpanNodeDocument[];
}

/** The JSON tree, built without recursion so a trace of any depth cannot overflow the stack. */
export function treeDocument(roots: readonly SpanTreeNode[]): readonly SpanNodeDocument[] {
  const out: SpanNodeDocument[] = [];
  const stack: { node: SpanTreeNode; into: SpanNodeDocument[] }[] = [...roots]
    .reverse()
    .map((node) => ({ node, into: out }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node } = item;
    const children: SpanNodeDocument[] = [];
    const failure = spanFailure(node.span);
    item.into.push({
      spanId: node.span.spanId,
      service: node.span.service,
      kind: node.span.spanKind,
      title: spanTitle(node.span),
      result: spanResult(node.span),
      failure: failure === '' ? null : failure,
      orphan: node.orphan,
      children,
    });
    for (const child of [...node.children].reverse()) {
      stack.push({ node: child, into: children });
    }
  }
  return out;
}

export type StatusDocument =
  | { readonly status: 'provisional' | 'complete' }
  | { readonly status: 'incomplete'; readonly reason: string };

export function statusDocument(completeness: ObservationCompleteness): StatusDocument {
  return completeness.status === 'incomplete'
    ? { status: completeness.status, reason: completeness.reason }
    : { status: completeness.status };
}
