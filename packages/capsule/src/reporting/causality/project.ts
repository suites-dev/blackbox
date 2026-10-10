import { investigationAttributeKeys, sessionCompleteness } from '../../investigation/index.js';
import type { CapsuleActivityReport } from '../../model/execution/activity.js';
import type { RedactionContext } from '../redaction/text.js';
import { projectTraceSpans } from '../telemetry.js';
import type { CapsuleReportProjectionInput } from '../types.js';
import { causalityFromTraces } from './core.js';
import type { CapsuleReportCausality, TraceSpans } from './types.js';

function traceSpans(input: {
  readonly traceIds: readonly string[];
  readonly traceObservations: CapsuleReportProjectionInput['traceObservations'];
  readonly context: RedactionContext;
}): readonly TraceSpans[] {
  const { traceObservations } = input;
  const retained = new Map(
    traceObservations.kind === 'collector-traces-found'
      ? traceObservations.traces.map((trace) => [trace.traceId, trace.fragments] as const)
      : [],
  );
  return input.traceIds.map((traceId) => {
    const fragments = retained.get(traceId);
    const spans =
      fragments === undefined
        ? []
        : projectTraceSpans(
            { fragments, traceId, context: input.context },
            investigationAttributeKeys,
          );
    const missing =
      traceObservations.kind === 'collector-traces-corrupt' ? 'corrupt' : 'not-retained';
    return { traceId, spans, unavailable: spans.length > 0 ? null : missing };
  });
}

/**
 * The report's causal view of a capsule: the retained traces projected into
 * spans, then {@link causalityFromTraces}. Span text passes through the
 * report's redaction context.
 */
export function projectCausality(input: {
  readonly state: CapsuleReportProjectionInput['record']['state'];
  readonly observations: CapsuleReportProjectionInput['observations'];
  readonly traceObservations: CapsuleReportProjectionInput['traceObservations'];
  readonly activities: readonly CapsuleActivityReport[];
  readonly context: RedactionContext;
}): CapsuleReportCausality {
  const collected =
    input.observations.kind === 'collector-session-found' ? input.observations.traceIds : [];
  const own = input.activities.map((activity) => activity.telemetry.context.traceId);
  return causalityFromTraces({
    completeness: sessionCompleteness({ state: input.state, session: input.observations }),
    activities: input.activities,
    traces: traceSpans({
      traceIds: [...new Set([...collected, ...own])],
      traceObservations: input.traceObservations,
      context: input.context,
    }),
  });
}
