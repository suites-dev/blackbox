import type { CollectorActivityReadResult } from '@suites/blackbox-otel-collector-internal';
import type { CapsuleActivityTelemetry } from './telemetry-types.js';
import { array, object, string, attribute, type Context } from './telemetry/fields.js';
import { spanProjection } from './telemetry/span.js';

export function projectActivityTelemetry(
  result: CollectorActivityReadResult,
  context: Context,
): CapsuleActivityTelemetry {
  if (result.kind !== 'collector-activity-found') {
    return {
      kind: 'unavailable',
      activityId: result.activityId,
      reason: result.kind === 'collector-activity-corrupt' ? 'corrupt' : 'not-retained',
    };
  }
  const spans = result.fragments.flatMap((fragment) =>
    array(object(fragment.request).resourceSpans).flatMap((resource) => {
      const item = object(resource);
      const service = attribute(object(item.resource).attributes, 'service.name');
      return array(item.scopeSpans).flatMap((scope) =>
        array(object(scope).spans)
          .map(object)
          .filter((span) => result.traceIds.includes(string(span.traceId)))
          .map((span) => spanProjection(span, service, context)),
      );
    }),
  );
  const unique = [
    ...new Map(spans.map((span) => [span.traceId + ':' + span.spanId, span])).values(),
  ];
  return unique.length > 0
    ? { kind: 'available', activityId: result.activityId, spans: unique }
    : { kind: 'unavailable', activityId: result.activityId, reason: 'not-retained' };
}
