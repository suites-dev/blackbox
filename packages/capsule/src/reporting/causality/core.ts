import {
  activityContext,
  activityWindowEndMs,
  buildSpanTree,
  earliestStart,
  placeTraces,
  spanTitle,
  statusDocument,
  treeDocument,
  walkSpanTree,
  type ObservationCompleteness,
} from '../../investigation/index.js';
import type { CapsuleActivityReport } from '../../model/execution/activity.js';
import { activityLimitations, capsuleLimitations } from './limitations.js';
import type {
  CapsuleReportActivityCausality,
  CapsuleReportCausality,
  CapsuleReportEvidence,
  CapsuleReportUncausedTrace,
  BuiltTrace,
  TraceSpans,
  Uncaused,
} from './types.js';

/** What an activity provides, from its purpose: preparation, a response, or a state check. */
function evidenceOf(purpose: CapsuleActivityReport['purpose']): CapsuleReportEvidence {
  switch (purpose) {
    case 'setup':
      return 'state-preparation';
    case 'stimulus':
      return 'response';
    case 'inspection':
      return 'state-check';
  }
}

/** The span IDs of the activities' own context spans, by trace: they stand for the activities. */
function contextSpanIds(
  activities: readonly CapsuleActivityReport[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byTrace = new Map<string, Set<string>>();
  for (const activity of activities) {
    const { traceId, spanId } = activity.telemetry.context;
    byTrace.set(traceId, (byTrace.get(traceId) ?? new Set()).add(spanId));
  }
  return byTrace;
}

function buildTrace(
  trace: TraceSpans,
  activitySpanIds: ReadonlySet<string>,
  provisional: boolean,
): BuiltTrace {
  const roots = buildSpanTree({ spans: trace.spans, activitySpanIds, provisional });
  const walked = walkSpanTree(roots);
  return {
    caused: {
      traceId: trace.traceId,
      spanCount: walked.length,
      services: [...new Set(walked.map(({ node }) => node.span.service))],
      tree: treeDocument(roots),
    },
    orphans: roots.flatMap((root) => (root.orphan === null ? [] : [root.span.spanId])),
  };
}

function spanCountOf(built: ReadonlyMap<string, BuiltTrace>, traceId: string): number {
  const trace = built.get(traceId);
  return trace === undefined ? 0 : trace.caused.spanCount;
}

function uncausedPlacements(input: {
  readonly activities: readonly CapsuleActivityReport[];
  readonly traces: readonly TraceSpans[];
  readonly built: ReadonlyMap<string, BuiltTrace>;
}): readonly Uncaused[] {
  const placements = placeTraces({
    activities: input.activities.map((activity) => ({
      activityId: activity.activityId,
      sequence: activity.sequence,
      traceId: activity.telemetry.context.traceId,
      startedAt: activity.startedAt,
    })),
    traces: input.traces
      .filter((trace) => spanCountOf(input.built, trace.traceId) > 0)
      .map((trace) => ({
        traceId: trace.traceId,
        earliestStartUnixNano: earliestStart(trace.spans),
      })),
  });
  return placements.filter((placement): placement is Uncaused => placement.kind === 'uncaused');
}

function uncausedEntry(
  placement: Uncaused,
  trace: TraceSpans,
  provisional: boolean,
): CapsuleReportUncausedTrace {
  const root = buildSpanTree({
    spans: trace.spans,
    activitySpanIds: new Set(),
    provisional,
  }).at(0);
  return {
    trace: placement.traceId,
    placedAfter: placement.placedAfter,
    rootService: root === undefined ? '' : root.span.service,
    rootTitle: root === undefined ? '' : spanTitle(root.span),
  };
}

/**
 * The uncaused traces that started in the activity's time window, as `show`
 * lists them under it. A display grouping: the time does not make a cause.
 */
function uncausedInWindow(
  activity: CapsuleActivityReport,
  ordered: readonly CapsuleActivityReport[],
  placements: readonly Uncaused[],
): readonly Uncaused[] {
  const next = ordered.at(ordered.findIndex((item) => item.activityId === activity.activityId) + 1);
  const windowEnd = activityWindowEndMs({
    completedAt: activity.kind === 'running' ? null : activity.completedAt,
    nextStartedAt: next === undefined ? null : next.startedAt,
  });
  return placements.filter(
    (placement) =>
      placement.placedAfter === activity.activityId &&
      placement.earliestStartUnixNano !== null &&
      Number(BigInt(placement.earliestStartUnixNano) / 1_000_000n) < windowEnd,
  );
}

/**
 * The report's causal view of a capsule, from the same functions `capsule
 * show` uses. A trace belongs to an activity only when its trace ID equals the
 * activity's context trace ID; every other trace is `uncaused`, placed by time
 * for display only. Absent evidence is a limitation, never a finding.
 */
export function causalityFromTraces(input: {
  readonly completeness: ObservationCompleteness;
  readonly activities: readonly CapsuleActivityReport[];
  readonly traces: readonly TraceSpans[];
}): CapsuleReportCausality {
  const { completeness, activities, traces } = input;
  const provisional = completeness.status === 'provisional';
  const owned = contextSpanIds(activities);
  const built = new Map(
    traces.map((trace) => [
      trace.traceId,
      buildTrace(trace, owned.get(trace.traceId) ?? new Set(), provisional),
    ]),
  );
  const placements = uncausedPlacements({ activities, traces, built });
  const uncaused = placements.flatMap((placement) => {
    const trace = traces.find((item) => item.traceId === placement.traceId);
    return trace === undefined ? [] : [uncausedEntry(placement, trace, provisional)];
  });
  const ordered = [...activities].sort((left, right) => {
    const difference = Date.parse(left.startedAt) - Date.parse(right.startedAt);
    return difference === 0 ? left.sequence - right.sequence : difference;
  });
  const activityCausality = activities.map((activity): CapsuleReportActivityCausality => {
    const traceId = activity.telemetry.context.traceId;
    const candidate = built.get(traceId);
    const own = candidate !== undefined && candidate.caused.spanCount > 0 ? candidate : null;
    const context = activityContext(activity);
    return {
      activityId: activity.activityId,
      evidence: evidenceOf(activity.purpose),
      context,
      causedTraces: own === null ? [] : [own.caused],
      limitations: activityLimitations({
        provisional,
        unknown: uncausedInWindow(activity, ordered, placements),
        context,
        own,
        ownTrace: traces.find((trace) => trace.traceId === traceId) ?? null,
      }),
    };
  });
  return {
    ...statusDocument(completeness),
    activityCausality,
    uncaused,
    limitations: capsuleLimitations({
      completeness,
      uncaused,
      unavailable: traces.filter((trace) => !owned.has(trace.traceId)),
    }),
  };
}
