import type { CapsuleActivityReport } from '../types.js';
import { redactError } from './redaction.js';
import type { RedactionContext } from './redaction/text.js';
import { projectTraceSpans } from './telemetry.js';
import type {
  CapsuleReportObservations,
  CapsuleReportProjectionInput,
  CapsuleReportSessionTrace,
  CapsuleReportSessionTraceAssociation,
  CapsuleReportTraceClassification,
} from './types.js';

function traceStartedAt(trace: CapsuleReportSessionTrace): number | null {
  if (trace.kind !== 'available') {
    return null;
  }
  const timestamps = trace.spans.flatMap((span) =>
    span.startTimeUnixNano === null ? [] : [BigInt(span.startTimeUnixNano)],
  );
  if (timestamps.length === 0) {
    return null;
  }
  const earliest = timestamps.reduce((left, right) => (left < right ? left : right));
  return Number(earliest / 1_000_000n);
}

function association(
  trace: CapsuleReportSessionTrace,
  activities: readonly CapsuleActivityReport[],
): CapsuleReportSessionTraceAssociation {
  const startedAt = traceStartedAt(trace);
  if (startedAt === null) {
    return { kind: 'session-only' };
  }
  const ordered = [...activities].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const activity = ordered[index];
    const nextStartedAt =
      ordered.slice(index + 1, index + 2).map((item) => Date.parse(item.startedAt))[0] ??
      Number.POSITIVE_INFINITY;
    if (
      activity.purpose === 'stimulus' &&
      Date.parse(activity.startedAt) <= startedAt &&
      startedAt < nextStartedAt
    ) {
      return { kind: 'activity-window', activityId: activity.activityId };
    }
  }
  return { kind: 'session-only' };
}

function sessionTraces(input: {
  readonly traceIds: readonly string[];
  readonly traceObservations: CapsuleReportProjectionInput['traceObservations'];
  readonly activities: readonly CapsuleActivityReport[];
  readonly context: RedactionContext;
}): readonly CapsuleReportSessionTrace[] {
  return input.traceIds.map((traceId) => {
    if (input.traceObservations.kind !== 'collector-traces-found') {
      return {
        kind: 'unavailable' as const,
        traceId,
        association: { kind: 'session-only' as const },
        reason:
          input.traceObservations.kind === 'collector-traces-corrupt'
            ? ('corrupt' as const)
            : ('not-retained' as const),
      };
    }
    const retained = input.traceObservations.traces.find((trace) => trace.traceId === traceId);
    const spans =
      retained === undefined
        ? []
        : projectTraceSpans({ fragments: retained.fragments, traceId, context: input.context });
    const trace: CapsuleReportSessionTrace =
      spans.length === 0
        ? {
            kind: 'unavailable',
            traceId,
            association: { kind: 'session-only' },
            reason: 'not-retained',
          }
        : {
            kind: 'available',
            traceId,
            association: { kind: 'session-only' },
            spans,
          };
    return { ...trace, association: association(trace, input.activities) };
  });
}

function classifyTraces(input: {
  readonly traceIds: readonly string[];
  readonly activities: readonly CapsuleActivityReport[];
  readonly traceObservations: CapsuleReportProjectionInput['traceObservations'];
  readonly context: RedactionContext;
}): CapsuleReportTraceClassification {
  const activityIdsByTrace = new Map<string, string[]>();
  for (const activity of input.activities) {
    const traceId = activity.telemetry.context.traceId;
    const activityIds = activityIdsByTrace.get(traceId) ?? [];
    activityIdsByTrace.set(traceId, [...activityIds, activity.activityId]);
  }
  const activityCorrelated = input.traceIds.flatMap((traceId) => {
    const activityIds = activityIdsByTrace.get(traceId);
    return activityIds === undefined ? [] : [{ traceId, activityIds }];
  });
  const sessionOnly = sessionTraces({
    traceIds: input.traceIds.filter((traceId) => !activityIdsByTrace.has(traceId)),
    traceObservations: input.traceObservations,
    activities: input.activities,
    context: input.context,
  });
  return { activityCorrelated, sessionOnly };
}

export function projectObservations(input: {
  readonly observations: CapsuleReportProjectionInput['observations'];
  readonly traceObservations: CapsuleReportProjectionInput['traceObservations'];
  readonly activities: readonly CapsuleActivityReport[];
  readonly context: RedactionContext;
}): CapsuleReportObservations {
  const { observations } = input;
  if (observations.kind === 'collector-session-missing') {
    return { kind: observations.kind, message: observations.message };
  }
  if (observations.kind === 'collector-session-corrupt') {
    return {
      kind: observations.kind,
      error: redactError({
        error: observations.error,
        location: 'observations.error',
        context: input.context,
      }),
    };
  }
  const runs = observations.lifecycle.runs.map((run, index) => ({
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    stopped:
      run.stoppedAt === null
        ? { kind: 'not-stopped' as const }
        : { kind: 'stopped' as const, at: run.stoppedAt },
    receiver: run.receiver,
    instrumentation: run.instrumentation,
    shutdown: run.shutdown,
    failure:
      run.failure === null
        ? { kind: 'none' as const }
        : {
            kind: 'recorded' as const,
            error: redactError({
              error: run.failure,
              location: `observations.runs[${String(index)}].failure`,
              context: input.context,
            }),
          },
  }));
  return {
    kind: observations.kind,
    telemetry: observations.lifecycle.telemetry,
    fragmentCount: observations.fragments.length,
    runs,
    traces: classifyTraces({
      traceIds: observations.traceIds,
      activities: input.activities,
      traceObservations: input.traceObservations,
      context: input.context,
    }),
  };
}
