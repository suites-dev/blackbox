import type {
  CollectorActivityReadResult,
  TraceFragment,
} from '@suites/blackbox-otel-collector-internal';
import type { CapsuleActivityTelemetry, CapsuleReportSpan } from './telemetry-types.js';
import { array, object, string, attribute, type Context } from './telemetry/fields.js';
import { spanProjection } from './telemetry/span.js';

export function projectActivityTelemetry(
  result: CollectorActivityReadResult,
  context: Context,
  exactTraceId: string,
): CapsuleActivityTelemetry {
  if (result.kind !== 'collector-activity-found') {
    return {
      kind: 'unavailable',
      activityId: result.activityId,
      reason: result.kind === 'collector-activity-corrupt' ? 'corrupt' : 'not-retained',
    };
  }
  const unique = projectTraceSpans({
    fragments: result.fragments,
    traceId: exactTraceId,
    context,
  });
  return unique.length > 0
    ? { kind: 'available', activityId: result.activityId, spans: unique }
    : { kind: 'unavailable', activityId: result.activityId, reason: 'not-retained' };
}

export function projectTraceSpans(input: {
  readonly fragments: readonly TraceFragment[];
  readonly traceId: string;
  readonly context: Context;
}): readonly CapsuleReportSpan[] {
  const spans = input.fragments.flatMap((fragment) =>
    array(object(fragment.request).resourceSpans).flatMap((resource) => {
      const item = object(resource);
      const service = attribute(object(item.resource).attributes, 'service.name');
      return array(item.scopeSpans).flatMap((scope) =>
        array(object(scope).spans)
          .map(object)
          .filter((span) => string(span.traceId) === input.traceId)
          .map((span) => spanProjection(span, service, input.context)),
      );
    }),
  );
  return [...new Map(spans.map((span) => [span.traceId + ':' + span.spanId, span])).values()];
}
