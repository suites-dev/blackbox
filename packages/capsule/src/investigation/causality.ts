/**
 * Causality between a capsule's activities and its traces. The ONLY causal
 * link is trace context: a trace is caused by an activity exactly when its
 * trace ID equals the activity's context trace ID. Time never implies cause;
 * it is used only to place an uncaused trace for display.
 */
export interface CausalityActivity {
  readonly activityId: string;
  readonly sequence: number;
  /** The activity's context trace ID. */
  readonly traceId: string;
  /** ISO 8601 time the activity started. */
  readonly startedAt: string;
}

export interface CausalityTrace {
  readonly traceId: string;
  /** Earliest retained span start (Unix nanoseconds), or null when none has one. */
  readonly earliestStartUnixNano: string | null;
}

export type TracePlacement =
  | { readonly kind: 'caused'; readonly traceId: string; readonly activityId: string }
  | {
      readonly kind: 'uncaused';
      readonly traceId: string;
      /** Display placement only: the latest activity started at or before the trace. */
      readonly placedAfter: string | null;
      readonly earliestStartUnixNano: string | null;
    };

/**
 * How long after an activity completes a trace that starts can still be placed
 * in its time window (the default `capsule run --wait`).
 */
export const ACTIVITY_WINDOW_GRACE_MS = 5_000;

/**
 * The end of an activity's time window, in Unix milliseconds: the next
 * activity's start or the activity's completion plus the grace, whichever is
 * first. A running activity's window stays open until the next one starts.
 */
export function activityWindowEndMs(input: {
  readonly completedAt: string | null;
  readonly nextStartedAt: string | null;
}): number {
  const next =
    input.nextStartedAt === null ? Number.POSITIVE_INFINITY : Date.parse(input.nextStartedAt);
  const completed =
    input.completedAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(input.completedAt) + ACTIVITY_WINDOW_GRACE_MS;
  return Math.min(next, completed);
}

export function isoToUnixNano(iso: string): bigint | null {
  const milliseconds = Date.parse(iso);
  return Number.isNaN(milliseconds) ? null : BigInt(milliseconds) * 1_000_000n;
}

function compareActivities(left: CausalityActivity, right: CausalityActivity): number {
  const a = isoToUnixNano(left.startedAt) ?? 0n;
  const b = isoToUnixNano(right.startedAt) ?? 0n;
  if (a !== b) {
    return a < b ? -1 : 1;
  }
  return left.sequence - right.sequence;
}

function compareStarts(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  const difference = BigInt(left) - BigInt(right);
  if (difference === 0n) {
    return 0;
  }
  return difference < 0n ? -1 : 1;
}

interface ActivityStart {
  readonly started: bigint;
  readonly activityId: string;
}

/**
 * The latest activity that started at or before `earliest`, by binary search
 * over activities already in start order (ties keep the later activity).
 */
function placedAfter(starts: readonly ActivityStart[], earliest: string | null): string | null {
  if (earliest === null) {
    return null;
  }
  const start = BigInt(earliest);
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle].started <= start) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low === 0 ? null : starts[low - 1].activityId;
}

/**
 * Places every trace: `caused` when its trace ID equals an activity's context
 * trace ID, otherwise `uncaused` after the latest activity that started at or
 * before the trace's earliest span (or before all activities). Uncaused
 * traces are returned in earliest-start order, then by trace ID.
 */
export function placeTraces(input: {
  readonly activities: readonly CausalityActivity[];
  readonly traces: readonly CausalityTrace[];
}): readonly TracePlacement[] {
  const ordered = [...input.activities].sort(compareActivities);
  const owner = new Map(ordered.map((activity) => [activity.traceId, activity.activityId]));
  // Activities whose start parses, in start order: placement is one binary
  // search per trace instead of a scan of every activity.
  const starts = ordered.flatMap((activity) => {
    const started = isoToUnixNano(activity.startedAt);
    return started === null ? [] : [{ started, activityId: activity.activityId }];
  });
  const caused: TracePlacement[] = [];
  const uncaused: Extract<TracePlacement, { kind: 'uncaused' }>[] = [];
  for (const trace of input.traces) {
    const activityId = owner.get(trace.traceId);
    if (activityId === undefined) {
      uncaused.push({
        kind: 'uncaused',
        traceId: trace.traceId,
        placedAfter: placedAfter(starts, trace.earliestStartUnixNano),
        earliestStartUnixNano: trace.earliestStartUnixNano,
      });
    } else {
      caused.push({ kind: 'caused', traceId: trace.traceId, activityId });
    }
  }
  uncaused.sort(
    (left, right) =>
      compareStarts(left.earliestStartUnixNano, right.earliestStartUnixNano) ||
      (left.traceId < right.traceId ? -1 : 1),
  );
  return [...caused, ...uncaused];
}

/** The earliest start among spans, or null when no span has a start time. */
export function earliestStart(
  spans: readonly { readonly startTimeUnixNano: string | null }[],
): string | null {
  let earliest: string | null = null;
  for (const span of spans) {
    if (span.startTimeUnixNano !== null && compareStarts(span.startTimeUnixNano, earliest) < 0) {
      earliest = span.startTimeUnixNano;
    }
  }
  return earliest;
}
