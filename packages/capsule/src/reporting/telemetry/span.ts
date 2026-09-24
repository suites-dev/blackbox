import type { CapsuleReportSpan } from '../telemetry-types.js';
import { array, object, string, safeText, type Context } from './fields.js';
import { attributes } from './attributes.js';

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/u.test(value) ? value : null;
}

export function spanProjection(
  span: Record<string, unknown>,
  service: unknown,
  context: Context,
): CapsuleReportSpan {
  const status = object(span.status).code;
  return {
    traceId: string(span.traceId),
    spanId: string(span.spanId),
    parentSpanId: string(span.parentSpanId) || null,
    operation: safeText(span.name, context),
    service: safeText(service, context) || 'Unavailable',
    startTimeUnixNano: timestamp(span.startTimeUnixNano),
    endTimeUnixNano: timestamp(span.endTimeUnixNano),
    statusCode: typeof status === 'number' ? status : null,
    attributes: attributes(span.attributes, context),
    links: array(span.links).map((link) => ({
      traceId: string(object(link).traceId),
      spanId: string(object(link).spanId),
    })),
  };
}
