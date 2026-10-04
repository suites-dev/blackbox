import {
  isoToUnixNano,
  spanFailure,
  spanResult,
  spanTitle,
  walkSpanTree,
  type CapsuleActivityReport,
  type ObservationCompleteness,
} from '@suites/blackbox-capsule';

import { formatColumns } from '../../cli/output.js';
import { nextSteps } from '../../cli/next-steps.js';
import type { CapsuleSummary } from '../../context/project-index.js';
import {
  offsetMs,
  rootSummary,
  type CapsuleInvestigation,
  type UncausedPlacement,
} from './investigation-model.js';
import { showDuration, statusText, traceShort, treeLines } from './show-format.js';
import { statusDocument, treeDocument } from './show-json.js';

export { activityView } from './show-activity.js';

function spanDuration(start: string | null, end: string | null): string {
  if (start === null || end === null) {
    return '-';
  }
  return showDuration(Number((BigInt(end) - BigInt(start)) / 1_000n) / 1000);
}

/** `SPAN PARENT SERVICE KIND TITLE RESULT DURATION FAILURE` rows in tree order. */
function spanRows(investigation: CapsuleInvestigation, traceId: string): readonly string[] {
  const rows = walkSpanTree(investigation.tree(traceId).roots).map(({ node }) => [
    node.span.spanId,
    node.span.parentSpanId ?? '-',
    node.span.service,
    node.span.spanKind,
    spanTitle(node.span),
    spanResult(node.span),
    spanDuration(node.span.startTimeUnixNano, node.span.endTimeUnixNano),
    spanFailure(node.span),
  ]);
  return formatColumns([
    ['SPAN', 'PARENT', 'SERVICE', 'KIND', 'TITLE', 'RESULT', 'DURATION', 'FAILURE'],
    ...rows,
  ]);
}

export function traceView(input: {
  readonly traceId: string;
  readonly investigation: CapsuleInvestigation;
  readonly associated: string | null;
  readonly spans: boolean;
}) {
  const { investigation, traceId } = input;
  const capsule = investigation.data.capsule.capsule;
  const tree = investigation.tree(traceId);
  const next = input.associated === null ? [] : [nextSteps.showActivity(input.associated, capsule)];
  const body = input.spans ? spanRows(investigation, traceId) : treeLines(tree.roots);
  const status = statusText(investigation.data.completeness);
  return {
    lines: [
      `trace ${traceId} · capsule ${capsule} · ${String(tree.spanCount)} spans · ${status}`,
      ...body.map((line) => `  ${line}`),
    ],
    next,
    document: {
      ...statusDocument(investigation.data.completeness),
      tree: treeDocument(tree.roots),
    },
  };
}

/** A trace ID that an explicit, still running capsule has not received yet. */
export function pendingTraceView(input: { readonly traceId: string; readonly capsule: string }) {
  const status = statusText({ status: 'provisional' });
  return {
    lines: [`trace ${input.traceId} · capsule ${input.capsule} · not observed yet · ${status}`],
    next: [nextSteps.showTimeline(input.capsule)],
    document: { status: 'provisional' as const },
  };
}

/**
 * `show <capsule>` keeps the phase 1 line and adds ` · <status>`; the
 * timeline header separates the status by two spaces like its other columns.
 */
function capsuleHead(
  capsule: CapsuleSummary,
  completeness: ObservationCompleteness,
  statusGap: ' ' | '  ',
): string {
  const status = statusText(completeness);
  return `capsule ${capsule.capsule}  ${capsule.system}  ${capsule.state}${statusGap}· ${status}`;
}

export function capsuleView(input: {
  readonly capsule: CapsuleSummary;
  readonly completeness: ObservationCompleteness;
  /** null when the capsule's activity record could not be read (shown as `?`, like `ls`). */
  readonly activities: readonly CapsuleActivityReport[] | null;
  readonly traceCount: number;
  readonly latest: string | null;
}) {
  const { capsule } = input;
  const next = input.latest === null ? [] : [nextSteps.showActivity(input.latest, capsule.capsule)];
  const activities = input.activities === null ? '?' : String(input.activities.length);
  return {
    lines: [
      capsuleHead(capsule, input.completeness, ' '),
      `  activities ${activities} · traces ${String(input.traceCount)}`,
    ],
    next,
    document: statusDocument(input.completeness),
  };
}

interface TimelineRow {
  readonly offsetMs: number;
  readonly activity: string | null;
  readonly trace: string | null;
  readonly marker: 'caused' | 'unknown' | 'none';
  readonly cells: readonly string[];
}

function activityRow(
  investigation: CapsuleInvestigation,
  activity: CapsuleActivityReport,
  short: (activityId: string) => string,
): TimelineRow {
  const started = isoToUnixNano(activity.startedAt);
  const offset = offsetMs(
    investigation.data.capsule.startedAt,
    started === null ? null : String(started),
  );
  const tree = investigation.tree(activity.telemetry.context.traceId);
  const name = activity.name.kind === 'provided' ? [activity.name.value] : [];
  const head = [`+${showDuration(offset)}`, short(activity.activityId), activity.purpose, ...name];
  const base = { offsetMs: offset, activity: activity.activityId };
  if (tree.spanCount === 0) {
    return { ...base, trace: null, marker: 'none', cells: [...head, '(no telemetry)'] };
  }
  const services = `${String(tree.services.length)} services`;
  return {
    ...base,
    trace: tree.traceId,
    marker: 'caused',
    cells: [...head, `── ${traceShort(tree.traceId)}`, services],
  };
}

function groupedUncaused(
  investigation: CapsuleInvestigation,
): ReadonlyMap<string | null, readonly UncausedPlacement[]> {
  const groups = new Map<string | null, UncausedPlacement[]>();
  for (const placement of investigation.uncaused()) {
    const group = groups.get(placement.placedAfter) ?? [];
    group.push(placement);
    groups.set(placement.placedAfter, group);
  }
  return groups;
}

function uncausedRows(
  investigation: CapsuleInvestigation,
  placedAfter: string | null,
  groups: ReadonlyMap<string | null, readonly UncausedPlacement[]>,
): readonly TimelineRow[] {
  const start = investigation.data.capsule.startedAt;
  return (groups.get(placedAfter) ?? [])
    .map((placement) => {
      const root = rootSummary(investigation.tree(placement.traceId));
      const offset = offsetMs(start, placement.earliestStartUnixNano);
      return {
        offsetMs: offset,
        activity: null,
        trace: placement.traceId,
        marker: 'unknown',
        cells: [
          `+${showDuration(offset)}`,
          '(no activity)',
          `┈┈ ${traceShort(placement.traceId)}`,
          root.service,
          root.title,
          root.result,
        ],
      };
    });
}

/** Uncaused traces before every activity, then each activity followed by its placed traces. */
function timelineRows(
  investigation: CapsuleInvestigation,
  short: (activityId: string) => string,
  groups: ReadonlyMap<string | null, readonly UncausedPlacement[]>,
): readonly TimelineRow[] {
  return [
    ...uncausedRows(investigation, null, groups),
    ...investigation
      .orderedActivities()
      .flatMap((activity) => [
        activityRow(investigation, activity, short),
        ...uncausedRows(investigation, activity.activityId, groups),
      ]),
  ];
}

/**
 * The human lines of the timeline. When the capsule has activities, the
 * uncaused traces placed before the first one (startup: activation, connects,
 * readiness probes) are one summary row; every other row is one line.
 * The JSON timeline keeps one row per trace.
 */
function humanRows(
  investigation: CapsuleInvestigation,
  rows: readonly TimelineRow[],
  before: readonly TimelineRow[],
) {
  const line = (row: TimelineRow) => `  ${row.cells.filter((cell) => cell !== '').join('  ')}`;
  if (before.length === 0) {
    return rows.map(line);
  }
  const summary = `  +${showDuration(before[0].offsetMs)}  (no activity)  ┈┈ ${String(before.length)} traces before the first activity`;
  return [summary, ...rows.slice(before.length).map(line)];
}

/** `show <capsule> --timeline`. Placement is display order, never cause. */
export function timelineView(input: {
  readonly investigation: CapsuleInvestigation;
  readonly short: (activityId: string) => string;
  readonly latest: string | null;
}) {
  const { investigation } = input;
  const capsule = investigation.data.capsule;
  const groups = groupedUncaused(investigation);
  const rows = timelineRows(investigation, input.short, groups);
  const before =
    investigation.data.activities.length === 0 ? [] : uncausedRows(investigation, null, groups);
  const markers = new Set(rows.map((row) => row.marker));
  const legend = [
    ...(markers.has('caused') ? ['  ── caused by the activity (trace context)'] : []),
    ...(markers.has('unknown') ? ['  ┈┈ observed in this capsule, cause unknown'] : []),
  ];
  return {
    lines: [
      capsuleHead(capsule, investigation.data.completeness, '  '),
      ...humanRows(investigation, rows, before),
      ...(legend.length === 0 ? [] : ['', ...legend]),
    ],
    next: input.latest === null ? [] : [nextSteps.showActivity(input.latest, capsule.capsule)],
    document: {
      ...statusDocument(investigation.data.completeness),
      timeline: rows.map((row) => ({
        offsetMs: Math.round(row.offsetMs),
        activity: row.activity,
        trace: row.trace,
        marker: row.marker,
      })),
    },
  };
}
