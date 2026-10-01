import {
  spanResult,
  spanTitle,
  type ActivityContext,
  type CapsuleActivityReport,
  type ObservationCompleteness,
  type OrphanMark,
  type SpanTreeNode,
} from '@suites/blackbox-capsule';

import { rootSummary, type CapsuleInvestigation } from './investigation-model.js';

/** JSON node of a span tree. Every span kind is included. */
export interface SpanNodeDocument {
  readonly spanId: string;
  readonly service: string;
  readonly kind: string;
  readonly title: string;
  readonly result: string;
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
    item.into.push({
      spanId: node.span.spanId,
      service: node.span.service,
      kind: node.span.spanKind,
      title: spanTitle(node.span),
      result: spanResult(node.span),
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

export type ActivityObservation = StatusDocument & {
  readonly traces: readonly string[];
  readonly services: readonly string[];
  readonly spans: number;
  readonly tree: readonly SpanNodeDocument[];
  readonly uncaused: readonly {
    readonly trace: string;
    readonly placedAfter: string | null;
    readonly rootService: string;
    readonly rootTitle: string;
  }[];
  /** How long the command waited for telemetry before reading this (show never waits). */
  readonly waitedMs: number;
  /** True when the wait hit its cap while spans were still arriving. */
  readonly stillArriving: boolean;
};

/** How long `run` waited for telemetry; `show` reads without waiting. */
export interface TelemetryWait {
  readonly waitedMs: number;
  readonly stillArriving: boolean;
}

export const NO_WAIT = { waitedMs: 0, stillArriving: false } satisfies TelemetryWait;

/** The `observation` of `show <activity> --json` and of `run --json`. */
export function observationDocument(
  input: {
    readonly activity: CapsuleActivityReport;
    readonly investigation: CapsuleInvestigation;
  },
  wait: TelemetryWait = NO_WAIT,
): ActivityObservation {
  const { activity, investigation } = input;
  const tree = investigation.tree(activity.telemetry.context.traceId);
  return {
    ...statusDocument(investigation.data.completeness),
    traces: tree.spanCount > 0 ? [tree.traceId] : [],
    services: tree.services,
    spans: tree.spanCount,
    tree: treeDocument(tree.roots),
    uncaused: investigation.uncausedAfter(activity).map((placement) => {
      const root = rootSummary(investigation.tree(placement.traceId));
      return {
        trace: placement.traceId,
        placedAfter: placement.placedAfter,
        rootService: root.service,
        rootTitle: root.title,
      };
    }),
    waitedMs: Math.round(wait.waitedMs),
    stillArriving: wait.stillArriving,
  };
}

export type Limitation =
  | { readonly kind: 'observation-provisional' }
  | { readonly kind: 'causality-unknown'; readonly trace: string }
  | { readonly kind: 'untraced' }
  | { readonly kind: 'context-not-carried'; readonly resource: string }
  | { readonly kind: 'orphan-span'; readonly spanId: string; readonly trace: string }
  | { readonly kind: 'still-arriving'; readonly waitedMs: number };

function contextLimitations(context: ActivityContext | null): readonly Limitation[] {
  if (context === null) {
    return [];
  }
  switch (context.kind) {
    case 'untraced':
      return [{ kind: 'untraced' }];
    case 'not-carried':
      return [{ kind: 'context-not-carried', resource: context.resource }];
    default:
      return [];
  }
}

export function limitationsOf(input: {
  readonly context: ActivityContext | null;
  readonly observation: ActivityObservation;
  readonly investigation: CapsuleInvestigation;
  readonly traceId: string;
}): readonly Limitation[] {
  const { context, observation } = input;
  return [
    ...(observation.status === 'provisional' ? [{ kind: 'observation-provisional' as const }] : []),
    ...observation.uncaused.map(({ trace }) => ({ kind: 'causality-unknown' as const, trace })),
    ...contextLimitations(context),
    ...input.investigation.orphans(input.traceId).map((node) => ({
      kind: 'orphan-span' as const,
      spanId: node.span.spanId,
      trace: input.traceId,
    })),
    ...(observation.stillArriving
      ? [{ kind: 'still-arriving' as const, waitedMs: observation.waitedMs }]
      : []),
  ];
}
