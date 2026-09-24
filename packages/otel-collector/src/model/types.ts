export interface CollectorIdentity {
  readonly sessionId: string;
  readonly executionId: string;
}

export interface CollectorHttpInput {
  readonly kind: 'http';
  readonly host: string;
  readonly port: number;
  readonly tracesPath: string;
  readonly activationPath: string;
  readonly readinessPath: string;
  readonly readPath: string;
}

export interface CollectorAuthorization {
  readonly kind: 'bearer-token';
  readonly token: string;
}

export interface CollectorLimits {
  readonly maxRequestBytes: number;
  readonly shutdownTimeoutMs: number;
}

export interface StartCollectorInput extends CollectorIdentity {
  readonly kind: 'start-collector';
  readonly storageDirectory: string;
  readonly endpoint: CollectorHttpInput;
  readonly authorization: CollectorAuthorization;
  readonly limits: CollectorLimits;
}

export interface CollectorEndpoint {
  readonly kind: 'http';
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly tracesPath: string;
  readonly tracesUrl: string;
  readonly activationPath: string;
  readonly activationUrl: string;
  readonly readinessPath: string;
  readonly readinessUrl: string;
  readonly readPath: string;
  readonly readUrl: string;
}

export interface CollectorFailure {
  readonly name: string;
  readonly message: string;
}

export type ReceiverStatus = 'ready' | 'draining' | 'stopped' | 'failed' | 'interrupted';
export type ShutdownStatus = 'not-started' | 'draining' | 'complete' | 'timed-out' | 'interrupted';

export interface CollectorActivationRecord {
  readonly kind: 'instrumentation-activation';
  readonly runtime: string;
  readonly serviceName: string;
  readonly activatedAt: string;
}

export type CollectorInstrumentationStatus =
  | { readonly kind: 'not-activated' }
  | {
      readonly kind: 'activated';
      readonly activations: readonly CollectorActivationRecord[];
    };

export interface CollectorRunRecord {
  readonly instanceId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stoppedAt: string | null;
  readonly receiver: ReceiverStatus;
  readonly instrumentation: CollectorInstrumentationStatus;
  readonly shutdown: ShutdownStatus;
  readonly failure: CollectorFailure | null;
  readonly endpoint: CollectorEndpoint;
}

export type CollectorTelemetryStatus =
  | {
      readonly status: 'not-received';
      readonly acceptedRequests: 0;
      readonly acceptedSpans: 0;
      readonly lastReceivedAt: null;
    }
  | {
      readonly status: 'received';
      readonly acceptedRequests: number;
      readonly acceptedSpans: number;
      readonly lastReceivedAt: string;
    };

export interface CollectorLifecycleRecord extends CollectorIdentity {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly runs: readonly CollectorRunRecord[];
  readonly telemetry: CollectorTelemetryStatus;
}

export interface CollectorStatus extends CollectorIdentity {
  readonly kind: 'collector-status';
  readonly instanceId: string;
  readonly receiver: ReceiverStatus;
  readonly instrumentation: CollectorInstrumentationStatus;
  readonly telemetry: CollectorTelemetryStatus;
  readonly shutdown: ShutdownStatus;
  readonly failure: CollectorFailure | null;
}

export type CollectorCloseResult =
  | {
      readonly kind: 'collector-stopped';
      readonly status: CollectorStatus;
      readonly alreadyStopped: boolean;
    }
  | {
      readonly kind: 'collector-stop-failed';
      readonly status: CollectorStatus;
      readonly error: CollectorFailure;
    };

export interface CollectorHandle extends CollectorIdentity {
  readonly kind: 'collector';
  readonly endpoint: CollectorEndpoint;
  readonly status: () => CollectorStatus;
  readonly close: () => Promise<CollectorCloseResult>;
}

export interface ReadCollectorSessionInput extends CollectorIdentity {
  readonly storageDirectory: string;
}

export interface ReadCollectorTraceInput extends ReadCollectorSessionInput {
  readonly traceId: string;
}

export interface ReadCollectorActivityInput extends ReadCollectorSessionInput {
  readonly activityId: string;
}

export interface ActivateCollectorInput extends CollectorIdentity {
  readonly schemaVersion: 1;
  readonly kind: 'instrumentation-activation-v1';
  readonly runtime: string;
  readonly serviceName: string;
}

export interface RetainedFragmentSummary {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly spanCount: number;
}

export type CollectorSessionReadResult =
  | {
      readonly kind: 'collector-session-found';
      readonly lifecycle: CollectorLifecycleRecord;
      readonly fragments: readonly RetainedFragmentSummary[];
      readonly traceIds: readonly string[];
    }
  | {
      readonly kind: 'collector-session-missing';
      readonly identity: CollectorIdentity;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-session-corrupt';
      readonly identity: CollectorIdentity;
      readonly error: CollectorFailure;
    };

export interface TraceFragment {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly request: unknown;
}

export type CollectorTraceReadResult =
  | {
      readonly kind: 'collector-trace-found';
      readonly identity: CollectorIdentity;
      readonly traceId: string;
      readonly fragments: readonly TraceFragment[];
    }
  | {
      readonly kind: 'collector-trace-missing';
      readonly identity: CollectorIdentity;
      readonly traceId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-trace-corrupt';
      readonly identity: CollectorIdentity;
      readonly traceId: string;
      readonly error: CollectorFailure;
    };

export type CollectorActivityReadResult =
  | {
      readonly kind: 'collector-activity-found';
      readonly identity: CollectorIdentity;
      readonly activityId: string;
      readonly fragments: readonly TraceFragment[];
      readonly traceIds: readonly string[];
    }
  | {
      readonly kind: 'collector-activity-missing';
      readonly identity: CollectorIdentity;
      readonly activityId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-activity-corrupt';
      readonly identity: CollectorIdentity;
      readonly activityId: string;
      readonly error: CollectorFailure;
    };

export interface RetainedFragment extends CollectorIdentity {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly receivedAt: string;
  readonly contentType: 'application/json';
  readonly contentEncoding: 'identity' | 'gzip';
  readonly spanCount: number;
  readonly rawJson: string;
}
