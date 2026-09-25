export interface W3CTraceStateAbsent {
  readonly kind: 'trace-state-absent';
}

export interface W3CTraceStatePresent {
  readonly kind: 'trace-state-present';
  readonly value: string;
}

export type W3CTraceState = W3CTraceStateAbsent | W3CTraceStatePresent;

export interface W3CTraceContext {
  readonly kind: 'w3c-trace-context';
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: '01';
  readonly traceparent: string;
  readonly traceState: W3CTraceState;
}
