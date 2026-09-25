import type { CapsuleActivityReport } from '../types.js';
import { redactError } from './redaction.js';
import type { RedactionContext } from './redaction/text.js';
import type {
  CapsuleReportObservations,
  CapsuleReportProjectionInput,
  CapsuleReportTraceClassification,
} from './types.js';

function classifyTraces(input: {
  readonly traceIds: readonly string[];
  readonly activities: readonly CapsuleActivityReport[];
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
  const sessionOnly = input.traceIds.filter((traceId) => !activityIdsByTrace.has(traceId));
  return { activityCorrelated, sessionOnly };
}

export function projectObservations(input: {
  readonly observations: CapsuleReportProjectionInput['observations'];
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
    traces: classifyTraces({ traceIds: observations.traceIds, activities: input.activities }),
  };
}
