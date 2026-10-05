import {
  activityWindowEndMs,
  buildSpanTree,
  earliestStart,
  isoToUnixNano,
  placeTraces,
  spanResult,
  spanTitle,
  walkSpanTree,
  type CapsuleActivityReport,
  type SpanTreeNode,
  type TracePlacement,
} from '@suites/blackbox-capsule';

import type { InvestigationData } from './investigation-data.js';

/** One retained trace as show presents it (activity context spans left out). */
export interface TraceTree {
  readonly traceId: string;
  readonly roots: readonly SpanTreeNode[];
  readonly spanCount: number;
  /** Services in tree order, each once. */
  readonly services: readonly string[];
  readonly earliestStartUnixNano: string | null;
}

export type UncausedPlacement = Extract<TracePlacement, { kind: 'uncaused' }>;

function traceTree(input: {
  readonly traceId: string;
  readonly spans: InvestigationData['traces'][number]['spans'];
  readonly activitySpanIds: ReadonlySet<string>;
  readonly provisional: boolean;
}): TraceTree {
  const roots = buildSpanTree(input);
  const walked = walkSpanTree(roots);
  return {
    traceId: input.traceId,
    roots,
    spanCount: walked.length,
    services: [...new Set(walked.map(({ node }) => node.span.service))],
    earliestStartUnixNano: earliestStart(walked.map(({ node }) => node.span)),
  };
}

/**
 * Trees and causality for one capsule. The context span of each activity is
 * the activity itself: it is never part of a tree, and its children are roots.
 */
export class CapsuleInvestigation {
  readonly data: InvestigationData;
  readonly #trees: ReadonlyMap<string, TraceTree>;
  readonly #placements: readonly TracePlacement[];

  constructor(data: InvestigationData) {
    this.data = data;
    const contextSpans = new Map<string, Set<string>>();
    for (const activity of data.activities) {
      const { traceId, spanId } = activity.telemetry.context;
      contextSpans.set(traceId, (contextSpans.get(traceId) ?? new Set()).add(spanId));
    }
    const provisional = data.completeness.status === 'provisional';
    this.#trees = new Map(
      data.traces.map((trace) => [
        trace.traceId,
        traceTree({
          traceId: trace.traceId,
          spans: trace.spans,
          activitySpanIds: contextSpans.get(trace.traceId) ?? new Set(),
          provisional,
        }),
      ]),
    );
    this.#placements = placeTraces({
      activities: data.activities.map((activity) => ({
        activityId: activity.activityId,
        sequence: activity.sequence,
        traceId: activity.telemetry.context.traceId,
        startedAt: activity.startedAt,
      })),
      traces: [...this.#trees.values()]
        .filter((tree) => tree.spanCount > 0)
        .map((tree) => ({
          traceId: tree.traceId,
          earliestStartUnixNano: tree.earliestStartUnixNano,
        })),
    });
  }

  /** The trace's tree; empty when nothing of it is retained. */
  tree(traceId: string): TraceTree {
    return (
      this.#trees.get(traceId) ?? {
        traceId,
        roots: [],
        spanCount: 0,
        services: [],
        earliestStartUnixNano: null,
      }
    );
  }

  /** Uncaused traces in placement order. */
  uncaused(): readonly UncausedPlacement[] {
    return this.#placements.filter(
      (placement): placement is UncausedPlacement => placement.kind === 'uncaused',
    );
  }

  /**
   * Uncaused traces that started in the activity's time window: placed after
   * it (so before the next activity started) and no later than the grace
   * after it completed. A later trace belongs to a later activity or to none.
   */
  uncausedAfter(activity: CapsuleActivityReport): readonly UncausedPlacement[] {
    const ordered = this.orderedActivities();
    const index = ordered.findIndex((item) => item.activityId === activity.activityId);
    const next = index < 0 ? undefined : ordered[index + 1];
    const windowEnd = activityWindowEndMs({
      completedAt: activity.kind === 'running' ? null : activity.completedAt,
      nextStartedAt: next === undefined ? null : next.startedAt,
    });
    return this.uncaused().filter(
      (placement) =>
        placement.placedAfter === activity.activityId &&
        placement.earliestStartUnixNano !== null &&
        Number(BigInt(placement.earliestStartUnixNano) / 1_000_000n) < windowEnd,
    );
  }

  /** Activities in start order (then sequence), as placement orders them. */
  orderedActivities(): readonly CapsuleActivityReport[] {
    return [...this.data.activities].sort((left, right) => {
      const difference = Date.parse(left.startedAt) - Date.parse(right.startedAt);
      return difference === 0 ? left.sequence - right.sequence : difference;
    });
  }

  /** Every orphan root of a trace. */
  orphans(traceId: string): readonly SpanTreeNode[] {
    return this.tree(traceId).roots.filter((root) => root.orphan !== null);
  }
}

/** The first root in tree order and its service, title and result. */
export function rootSummary(tree: TraceTree): {
  readonly service: string;
  readonly title: string;
  readonly result: string;
} {
  if (tree.roots.length === 0) {
    return { service: '', title: '', result: '' };
  }
  const root = tree.roots[0];
  return { service: root.span.service, title: spanTitle(root.span), result: spanResult(root.span) };
}

/** Milliseconds from an ISO time to a span start (Unix nanoseconds). */
export function offsetMs(fromIso: string, toUnixNano: string | null): number {
  const from = isoToUnixNano(fromIso);
  if (from === null || toUnixNano === null) {
    return 0;
  }
  return Number((BigInt(toUnixNano) - from) / 1_000n) / 1000;
}
