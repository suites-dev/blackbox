import type { CatalogEntryKind } from '@suites/blackbox-catalog';
import type {
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector';
import type { SandboxContainer, SandboxTelemetryStatus } from '@suites/blackbox-sandbox';

export type BlackboxCatalogSelection =
  { readonly kind: 'unselected' } | { readonly kind: CatalogEntryKind; readonly id: string };

export interface BlackboxEntrypoint {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
}

export interface BlackboxSandbox {
  readonly sandboxId: string;
  readonly executionId: string;
  readonly catalogEntry: {
    readonly id: string;
    readonly kind: CatalogEntryKind;
  };
  readonly projectName: string;
  readonly artifactDirectory: string;
  readonly entrypoint: BlackboxEntrypoint;
  readonly containers: ReadonlyMap<string, SandboxContainer>;
}

export type BlackboxSpanKind =
  'unspecified' | 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export type BlackboxSpanStatus = 'unset' | 'ok' | 'error';

/** One retained span, decoded from the collector's raw OTLP/JSON fragments. */
export interface BlackboxSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  /** The `service.name` resource attribute of the exporting process. */
  readonly service: string | null;
  readonly name: string;
  readonly kind: BlackboxSpanKind;
  readonly status: BlackboxSpanStatus;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

interface BlackboxSpanFilter {
  readonly traceId: string;
  readonly service: string;
  /** Exact span name, or a pattern it must match. */
  readonly name: string | RegExp;
  readonly kind: BlackboxSpanKind;
}

/** Every given field must match; an empty query matches every retained span. */
export type BlackboxSpanQuery = Partial<BlackboxSpanFilter>;

export type BlackboxSpanWaitOptions = Partial<{
  /** How long to wait for a matching span. Default: 10000. */
  readonly timeoutMs: number;
  /** Pause between reads of retained telemetry. Default: 250. */
  readonly intervalMs: number;
}>;

export interface BlackboxTelemetry {
  readonly sessionId: string;
  readonly executionId: string;
  /** W3C trace ID that the `request` fixture propagates for this attempt. */
  readonly traceId: string;
  /** The `traceparent` header value that `request` sends with every call. */
  readonly traceparent: string;
  inspect(): Promise<SandboxTelemetryStatus>;
  read(): Promise<CollectorSessionReadResult>;
  readTrace(traceId: string): Promise<CollectorTraceReadResult>;
  /** Retained spans of this attempt that match the query. */
  spans(query?: BlackboxSpanQuery): Promise<readonly BlackboxSpan[]>;
  /** Wait until a retained span matches the query, and return it. */
  waitForSpan(query: BlackboxSpanQuery, options?: BlackboxSpanWaitOptions): Promise<BlackboxSpan>;
}

/** Attempt-scoped handle evaluated by the configured effects provider. */
export interface BlackboxEffects {
  readonly sessionId: string;
  readonly executionId: string;
}

export interface BlackboxTestOptions {
  /** Catalog entry selected for every test in the current Playwright scope. */
  readonly catalogEntry: BlackboxCatalogSelection;
  /** Compose substitution environment supplied to the selected sandbox. */
  readonly blackboxEnvironment: Readonly<Record<string, string>>;
  /**
   * Copy each finished attempt (sandbox record, telemetry and attempt document) to
   * `.blackbox/experiments/<sandboxId>/` beside the Blackbox configuration, where the
   * next Playwright run does not clear it. Default: false.
   */
  readonly blackboxRetainAttempts: boolean;
}

export interface BlackboxTestFixtures {
  /** Read-only identity and resources for this test's isolated sandbox. */
  readonly sandbox: BlackboxSandbox;
  /** Raw retained telemetry for this physical test attempt. */
  readonly telemetry: BlackboxTelemetry;
  /** Attempt-scoped handle for evaluating normalized behavioral contracts. */
  readonly effects: BlackboxEffects;
}
