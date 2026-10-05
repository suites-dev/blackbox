import type { CapsuleReportException, CapsuleReportSpan } from '../telemetry-types.js';
import { array, attribute, object, string, safeText, type Context } from './fields.js';
import { attributes } from './attributes.js';

/** Messages are cut before redaction runs; a stack trace is never kept. */
const EXCEPTION_MESSAGE_LIMIT = 200;

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/u.test(value) ? value : null;
}

function spanKind(value: unknown): CapsuleReportSpan['spanKind'] {
  switch (value) {
    case 1:
      return 'internal';
    case 2:
      return 'server';
    case 3:
      return 'client';
    case 4:
      return 'producer';
    case 5:
      return 'consumer';
    default:
      return 'unspecified';
  }
}

function exceptions(events: unknown, context: Context): readonly CapsuleReportException[] {
  return array(events)
    .map(object)
    .filter((event) => event.name === 'exception')
    .map((event) => ({
      type: safeText(attribute(event.attributes, 'exception.type'), context),
      message: safeText(
        string(attribute(event.attributes, 'exception.message')).slice(0, EXCEPTION_MESSAGE_LIMIT),
        context,
      ),
    }))
    .filter((exception) => exception.type !== '' || exception.message !== '');
}

/** The status message (null when none) and the exception events. */
function failureFields(
  span: Record<string, unknown>,
  context: Context,
): Pick<CapsuleReportSpan, 'statusMessage' | 'exceptions'> {
  const message = safeText(object(span.status).message, context);
  return {
    statusMessage: message === '' ? null : message,
    exceptions: exceptions(span.events, context),
  };
}

export function spanProjection(
  span: Record<string, unknown>,
  service: unknown,
  context: Context,
  attributeKeys?: ReadonlySet<string>,
): CapsuleReportSpan {
  const status = object(span.status).code;
  return {
    traceId: string(span.traceId),
    spanId: string(span.spanId),
    parentSpanId: string(span.parentSpanId) || null,
    spanKind: spanKind(span.kind),
    operation: safeText(span.name, context),
    service: safeText(service, context) || 'Unavailable',
    startTimeUnixNano: timestamp(span.startTimeUnixNano),
    endTimeUnixNano: timestamp(span.endTimeUnixNano),
    statusCode: typeof status === 'number' ? status : null,
    ...failureFields(span, context),
    attributes: attributes(span.attributes, context, attributeKeys),
    links: array(span.links).map((link) => ({
      traceId: string(object(link).traceId),
      spanId: string(object(link).spanId),
    })),
  };
}
