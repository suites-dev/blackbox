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

function placedAfter(
  ordered: readonly CausalityActivity[],
  earliest: string | null,
): string | null {
  if (earliest === null) {
    return null;
  }
  const start = BigInt(earliest);
  let found: string | null = null;
  for (const activity of ordered) {
    const started = isoToUnixNano(activity.startedAt);
    if (started !== null && started <= start) {
      found = activity.activityId;
    }
  }
  return found;
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
  const caused: TracePlacement[] = [];
  const uncaused: Extract<TracePlacement, { kind: 'uncaused' }>[] = [];
  for (const trace of input.traces) {
    const activityId = owner.get(trace.traceId);
    if (activityId === undefined) {
      uncaused.push({
        kind: 'uncaused',
        traceId: trace.traceId,
        placedAfter: placedAfter(ordered, trace.earliestStartUnixNano),
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
