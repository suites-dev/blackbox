import type { TracePlacement } from '../../investigation/causality.js';
import type { SpanNodeDocument } from '../../investigation/tree-document.js';
import type { CapsuleReportSpan } from '../telemetry-types.js';

/** What an activity provides: state preparation, a response, or a state check. */
export type CapsuleReportEvidence = 'state-preparation' | 'response' | 'state-check';

/** A limitation of the evidence, never a finding: what Blackbox cannot say. */
export type CapsuleReportLimitation =
  | { readonly kind: 'observation-provisional' }
  | { readonly kind: 'observation-incomplete'; readonly reason: string }
  | { readonly kind: 'causality-unknown'; readonly trace: string }
  | { readonly kind: 'untraced' }
  | { readonly kind: 'context-not-carried'; readonly resource: string }
  | {
      readonly kind: 'context-injection-failed';
      readonly carrier: string;
      readonly message: string;
    }
  | { readonly kind: 'orphan-span'; readonly spanId: string; readonly trace: string }
  | {
      readonly kind: 'observation-unavailable';
      readonly trace: string;
      readonly reason: 'not-retained' | 'corrupt';
    };

/** A trace whose ID equals the activity's context trace ID, with its span tree as `show --json` prints it. */
export interface CapsuleReportCausedTrace {
  readonly traceId: string;
  readonly spanCount: number;
  readonly services: readonly string[];
  readonly tree: readonly SpanNodeDocument[];
}

/** What happened to an activity's trace context, as `capsule show` reports it. */
export type CapsuleReportActivityContext =
  | { readonly kind: 'sent'; readonly carrier: string }
  | { readonly kind: 'not-carried'; readonly resource: string }
  | { readonly kind: 'untraced' }
  | { readonly kind: 'not-sent' }
  | { readonly kind: 'injection-failed'; readonly carrier: string; readonly message: string };

export interface CapsuleReportActivityCausality {
  readonly activityId: string;
  readonly evidence: CapsuleReportEvidence;
  /** What happened to the activity's trace context; null when unknown. */
  readonly context: CapsuleReportActivityContext | null;
  readonly causedTraces: readonly CapsuleReportCausedTrace[];
  readonly limitations: readonly CapsuleReportLimitation[];
}

/** A trace no trace context links to any activity. `placedAfter` is display order only. */
export interface CapsuleReportUncausedTrace {
  readonly trace: string;
  readonly placedAfter: string | null;
  readonly rootService: string;
  readonly rootTitle: string;
}

/** The completeness of the retained observations, as `capsule show` states it. */
export type CapsuleReportStatus =
  | { readonly status: 'provisional' | 'complete' }
  | { readonly status: 'incomplete'; readonly reason: string };

export interface CapsuleReportCausalityFields {
  readonly activityCausality: readonly CapsuleReportActivityCausality[];
  readonly uncaused: readonly CapsuleReportUncausedTrace[];
  readonly limitations: readonly CapsuleReportLimitation[];
}

/** The report's causal view: status first, what each activity caused, what has no known cause. */
export type CapsuleReportCausality = CapsuleReportStatus & CapsuleReportCausalityFields;

/** One trace's retained spans, as projected for investigation titles. */
export interface TraceSpans {
  readonly traceId: string;
  /** Empty when nothing of the trace is retained. */
  readonly spans: readonly CapsuleReportSpan[];
  /** Why no span is retained; null when some are. */
  readonly unavailable: 'not-retained' | 'corrupt' | null;
}

export type Uncaused = Extract<TracePlacement, { kind: 'uncaused' }>;

export interface BuiltTrace {
  readonly caused: CapsuleReportCausedTrace;
  readonly orphans: readonly string[];
}
