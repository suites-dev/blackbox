/** Bounded raw OTEL projection. No events, payloads, process or host resource attributes. */
export interface CapsuleReportSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly operation: string;
  readonly service: string;
  readonly startTimeUnixNano: string | null;
  readonly endTimeUnixNano: string | null;
  readonly statusCode: number | null;
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
