export type DriverTelemetryContext =
  | { readonly kind: 'disabled' }
  | {
      readonly kind: 'w3c-trace-context';
      readonly sessionId: string;
      readonly activityId: string;
      readonly traceparent: string;
      readonly tracestate:
        | { readonly kind: 'absent' }
        | { readonly kind: 'present'; readonly value: string };
    };
