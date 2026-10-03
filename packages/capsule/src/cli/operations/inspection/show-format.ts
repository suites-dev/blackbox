import {
  spanFailure,
  walkSpanTree,
  spanResult,
  spanTitle,
  type ActivityContext,
  type CapsuleActivityReport,
  type ObservationCompleteness,
  type SpanTreeNode,
} from '@suites/blackbox-capsule';

import { locationText, processOutcome, processResultText } from '../run/run-output.js';

/** `provisional (capsule running)`, `complete` or `incomplete (<reason>)`. */
export function statusText(completeness: ObservationCompleteness): string {
  switch (completeness.status) {
    case 'provisional':
      return 'provisional (capsule running)';
    case 'complete':
      return 'complete';
    case 'incomplete':
      return `incomplete (${completeness.reason})`;
  }
}

/** Under 1 s `<n>ms`, under 60 s `<n.n>s`, otherwise `<m>m<ss>s`. */
export function showDuration(milliseconds: number): string {
  const rounded = Math.max(0, Math.round(milliseconds));
  if (rounded < 1000) {
    return `${String(rounded)}ms`;
  }
  const tenths = Math.round(rounded / 100);
  if (tenths < 600) {
    return `${(tenths / 10).toFixed(1)}s`;
  }
  const seconds = Math.round(rounded / 1000);
  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60).padStart(2, '0')}s`;
}

export function traceShort(traceId: string): string {
  return traceId.slice(0, 8);
}

const ORPHAN_TEXT = {
  'not-yet-observed': '(parent not yet observed)',
  'not-retained': '(parent not retained)',
} as const;

/**
 * `<service>  <title>  <result>  <failure>` (two spaces apart) with missing parts
 * left out; the failure is an error span's exception or error type.
 */
export function spanLabel(node: SpanTreeNode): string {
  const parts = [
    node.span.service,
    spanTitle(node.span),
    spanResult(node.span),
    spanFailure(node.span),
  ];
  if (node.orphan !== null) {
    parts.push(ORPHAN_TEXT[node.orphan]);
  }
  return parts.filter((part) => part !== '').join('  ');
}

/**
 * Tree lines like `tree`: roots have no prefix, children get `├─ `/`└─ `,
 * and each deeper level adds `│  ` or three spaces per ancestor.
 */
export function treeLines(
  roots: readonly SpanTreeNode[],
  /** Stop after this many lines (`run`); `show` prints every span. */
  limit: number = Number.POSITIVE_INFINITY,
): readonly string[] {
  const lines: string[] = [];
  const stack: { node: SpanTreeNode; prefix: string; connector: string }[] = [...roots]
    .reverse()
    .map((node) => ({ node, prefix: '', connector: '' }));
  for (
    let item = lines.length < limit ? stack.pop() : undefined;
    item !== undefined;
    item = lines.length < limit ? stack.pop() : undefined
  ) {
    lines.push(`${item.prefix}${item.connector}${spanLabel(item.node)}`);
    const continuation = item.connector === '' ? '' : item.connector === '└─ ' ? '   ' : '│  ';
    const childPrefix = `${item.prefix}${continuation}`;
    const children = item.node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: children[index],
        prefix: childPrefix,
        connector: index === children.length - 1 ? '└─ ' : '├─ ',
      });
    }
  }
  return lines;
}

/** Spans above which `show <activity>` summarizes its tree unless `--full`. */
export const SUMMARY_SPAN_LIMIT = 40;

/**
 * One small ID per distinct subtree shape (its label and its children's
 * shapes), computed children first and without recursion.
 */
function subtreeShapes(roots: readonly SpanTreeNode[]): ReadonlyMap<SpanTreeNode, number> {
  const ids = new Map<string, number>();
  const shapes = new Map<SpanTreeNode, number>();
  for (const { node } of [...walkSpanTree(roots)].reverse()) {
    const key = `${spanLabel(node)}|${node.children.map((child) => shapes.get(child)).join(',')}`;
    const id = ids.get(key) ?? ids.size;
    ids.set(key, id);
    shapes.set(node, id);
  }
  return shapes;
}

/** Consecutive siblings with the same shape, as one node and how many times it repeats. */
function repeatedRuns(
  nodes: readonly SpanTreeNode[],
  shapes: ReadonlyMap<SpanTreeNode, number>,
): readonly { readonly node: SpanTreeNode; readonly count: number }[] {
  const runs: { node: SpanTreeNode; count: number }[] = [];
  for (const node of nodes) {
    const last = runs.at(-1);
    if (last !== undefined && shapes.get(last.node) === shapes.get(node)) {
      last.count += 1;
    } else {
      runs.push({ node, count: 1 });
    }
  }
  return runs;
}

/**
 * Tree lines like {@link treeLines}, folded: a run of identical sibling subtrees
 * (same titles, results and structure) prints once, its root marked `×N`, and a
 * subtree identical to one already printed shows only its root, marked as such.
 */
export function summarizedTreeLines(roots: readonly SpanTreeNode[]): readonly string[] {
  const shapes = subtreeShapes(roots);
  const printed = new Set<number>();
  const lines: string[] = [];
  const stack = [...repeatedRuns(roots, shapes)]
    .reverse()
    .map((run) => ({ ...run, prefix: '', connector: '' }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const repeat = item.count > 1 ? `  ×${String(item.count)}` : '';
    const shape = shapes.get(item.node) ?? -1;
    const seen = item.node.children.length > 0 && printed.has(shape);
    const label = `${spanLabel(item.node)}${repeat}${seen ? '  (same subtree as above)' : ''}`;
    lines.push(`${item.prefix}${item.connector}${label}`);
    printed.add(shape);
    const continuation = item.connector === '' ? '' : item.connector === '└─ ' ? '   ' : '│  ';
    const children = seen ? [] : repeatedRuns(item.node.children, shapes);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        ...children[index],
        prefix: `${item.prefix}${continuation}`,
        connector: index === children.length - 1 ? '└─ ' : '├─ ',
      });
    }
  }
  return lines;
}

/** `ts-travel-service 25, ts-route-service 30, …`: spans per service, in tree order. */
export function serviceCounts(roots: readonly SpanTreeNode[]): string {
  const counts = new Map<string, number>();
  for (const { node } of walkSpanTree(roots)) {
    counts.set(node.span.service, (counts.get(node.span.service) ?? 0) + 1);
  }
  return [...counts].map(([service, count]) => `${service} ${String(count)}`).join(', ');
}

export function contextText(context: ActivityContext, driver: string | null): string {
  switch (context.kind) {
    case 'sent':
      return `sent (w3c, ${context.carrier})`;
    case 'not-carried':
      return `not carried: ${context.resource} is shared state (expected for this driver)`;
    case 'untraced':
      return 'untraced: no driver, so no trace context was sent';
    case 'not-sent':
      return `not sent: driver ${driver ?? ''} declares no propagation`;
    case 'injection-failed':
      return `injection failed: ${context.message}`;
  }
}

/** `exit N on host`, `not found on participant p`, `not run`; other states as recorded. */
export function processText(activity: CapsuleActivityReport): string {
  if (activity.kind !== 'completed') {
    return activity.kind;
  }
  const process = processOutcome(activity.outcome);
  if (process === null) {
    return 'not run';
  }
  return `${processResultText(process)} on ${locationText(process.location)}`;
}

/** `<driver> → <participant> (<protocol>)`, `<driver>` before it resolved, or `host`. */
export function viaText(activity: CapsuleActivityReport): string {
  if (activity.target.kind === 'host') {
    return 'host';
  }
  if (activity.kind === 'completed' && activity.outcome.kind === 'driver-completed') {
    const { id, target } = activity.outcome.driver;
    return `${id} → ${target.participantId} (${target.protocol})`;
  }
  return activity.target.driverId;
}

/** `label` padded like the phase 1 show lines (two spaces, ten columns). */
export function field(label: string, value: string): string {
  return `  ${label.padEnd(10)}${value}`;
}
