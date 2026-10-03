import { activityAdmissionLimits } from './limits.js';
import type { ActivityProvenance, ActivitySelection } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collection(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Invalid activity payload: ${name}.`);
  }
  return value;
}

function spanIdentity(
  span: unknown,
  activity: ActivitySelection['activities'][number],
  selection: ActivitySelection,
) {
  if (
    !record(span) ||
    typeof span.traceId !== 'string' ||
    !activity.traceIds.includes(span.traceId.toLowerCase())
  ) {
    throw new TypeError('Foreign span trace is outside its registered activity.');
  }
  if (
    typeof span.spanId !== 'string' ||
    !/^[\da-f]{16}$/iu.test(span.spanId) ||
    /^0+$/u.test(span.spanId)
  ) {
    throw new TypeError('Invalid admitted span ID.');
  }
  markers(span, activity, selection);
  return { traceId: span.traceId.toLowerCase(), spanId: span.spanId.toLowerCase() };
}

function markers(
  carrier: unknown,
  activity: ActivitySelection['activities'][number],
  selection: ActivitySelection,
): void {
  if (carrier === undefined) {
    return;
  }
  if (!record(carrier)) {
    throw new TypeError('Invalid activity attribute carrier.');
  }
  if (carrier.attributes === undefined) {
    return;
  }
  const expectations = new Map([
    ['blackbox.session.id', selection.sessionId],
    ['blackbox.execution.id', selection.executionId],
    ['blackbox.activity.id', activity.activityId],
    ['blackbox.activity.purpose', activity.purpose],
  ]);
  const seen = new Set<string>();
  for (const attribute of collection(carrier.attributes, 'attributes')) {
    if (!record(attribute)) {
      throw new TypeError('Invalid activity span attribute.');
    }
    const expected =
      typeof attribute.key === 'string' ? expectations.get(attribute.key) : undefined;
    if (expected === undefined) {
      continue;
    }
    const key = String(attribute.key);
    if (
      seen.has(key) ||
      !record(attribute.value) ||
      Object.keys(attribute.value).length !== 1 ||
      attribute.value.stringValue !== expected
    ) {
      throw new TypeError('Activity marker conflicts with trusted ownership.');
    }
    seen.add(key);
  }
}

/** Parsed collector data only; this does not sandbox arbitrary JavaScript objects. */
export function createPayloadAdmission(selection: ActivitySelection) {
  const provenance: Record<string, readonly ActivityProvenance[]> = {};
  const identities = new Set<string>();
  let bytes = 0;
  return {
    provenance,
    admit(payload: unknown, activity: ActivitySelection['activities'][number]): unknown {
      if (!record(payload)) {
        throw new TypeError('Invalid activity OTLP request.');
      }
      const serialized = JSON.stringify(payload);
      bytes += Buffer.byteLength(serialized);
      if (bytes > activityAdmissionLimits.payloadBytes) {
        throw new RangeError('Selected activity payload exceeds 256 KiB.');
      }
      for (const resource of collection(payload.resourceSpans, 'resourceSpans')) {
        if (!record(resource)) {
          throw new TypeError('Invalid activity resource.');
        }
        markers(resource.resource, activity, selection);
        for (const scope of collection(resource.scopeSpans, 'scopeSpans')) {
          if (!record(scope)) {
            throw new TypeError('Invalid activity instrumentation scope.');
          }
          for (const span of collection(scope.spans, 'spans')) {
            const { traceId, spanId } = spanIdentity(span, activity, selection);
            const encodedRecord = JSON.stringify({
              resource: resource.resource,
              scope: scope.scope,
              span,
              resourceSchemaUrl: resource.schemaUrl,
              scopeSchemaUrl: scope.schemaUrl,
            });
            if (Buffer.byteLength(encodedRecord) > activityAdmissionLimits.recordBytes) {
              throw new RangeError('Activity record exceeds 32 KiB.');
            }
            const key = `${traceId}:${spanId}`;
            identities.add(key);
            if (identities.size > activityAdmissionLimits.spanIdentities) {
              throw new RangeError('Activity selection exceeds 256 span identities.');
            }
            provenance[key] = [
              {
                sessionId: selection.sessionId,
                executionId: selection.executionId,
                activityId: activity.activityId,
                purpose: activity.purpose,
                traceId,
                spanId,
              },
            ];
          }
        }
      }
      // Keep duplicate arrivals and raw fields; the normalizer owns duplicate/conflict semantics.
      return JSON.parse(serialized) as unknown;
    },
  };
}
