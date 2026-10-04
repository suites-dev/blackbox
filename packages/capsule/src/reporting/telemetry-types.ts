/** One `exception` span event: its type and a redacted, truncated message. */
export interface CapsuleReportException {
  readonly type: string;
  readonly message: string;
}

/**
 * Bounded raw OTEL projection. No payloads, process or host resource attributes;
 * of the span events only `exception` events are kept (type and message, no stack).
 */
export interface CapsuleReportSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly spanKind:
    | 'unspecified'
    | 'internal'
    | 'server'
    | 'client'
    | 'producer'
    | 'consumer';
  readonly operation: string;
  readonly service: string;
  readonly startTimeUnixNano: string | null;
  readonly endTimeUnixNano: string | null;
  readonly statusCode: number | null;
  /** The OTEL status message; null when the span recorded none. */
  readonly statusMessage: string | null;
  /** The span's `exception` events (absent from reports written before they were kept). */
  readonly exceptions: readonly CapsuleReportException[];
  readonly attributes: readonly {
    readonly key: string;
    readonly value: string | number | boolean;
  }[];
  readonly links: readonly { readonly traceId: string; readonly spanId: string }[];
}

export type CapsuleActivityTelemetry =
  | {
      readonly kind: 'available';
      readonly activityId: string;
      readonly spans: readonly CapsuleReportSpan[];
    }
  | {
      readonly kind: 'unavailable';
      readonly activityId: string;
      readonly reason: 'not-retained' | 'corrupt';
    };
