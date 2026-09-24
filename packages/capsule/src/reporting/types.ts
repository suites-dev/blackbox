import type {
  CapsuleActivityReport,
  CapsuleAvailability,
  CapsuleCleanupReport,
  CapsuleContainerDetails,
  CapsuleDescription,
  CapsuleEntrypoint,
  CapsuleFailureRecord,
  CapsuleOperationFailure,
  CapsuleExecutionOutcome,
  CapsuleProgressEvent,
  CapsuleReadinessDetails,
  CapsuleRecordedError,
  CapsuleSessionState,
} from '../types.js';
import type { CapsuleSessionRecord } from '../records.js';
import type { CollectorSessionReadResult } from '@suites/blackbox-otel-collector-internal';

export type CapsuleReportLifecycle =
  | { readonly kind: 'running'; readonly retainedState: 'running' }
  | {
      readonly kind: 'starting';
      readonly retainedState: 'admitted' | 'manager-starting' | 'sandbox-starting';
    }
  | { readonly kind: 'stopping'; readonly retainedState: 'stopping' }
  | { readonly kind: 'stopped'; readonly retainedState: 'stopped' }
  | {
      readonly kind: 'failed';
      readonly retainedState: 'start-failed' | 'manager-failed' | 'stop-failed';
    };

export type CapsuleReportAvailability<Value> = CapsuleAvailability<Value>;

export type CapsuleReportFailureRecord = CapsuleFailureRecord;

export type CapsuleReportActivity =
  | Extract<CapsuleActivityReport, { readonly kind: 'running' }>
  | (Omit<Extract<CapsuleActivityReport, { readonly kind: 'completed' }>, 'argv' | 'outcome'> & {
      readonly argv: readonly string[];
      readonly outcome: CapsuleExecutionOutcome;
    })
  | (Omit<Extract<CapsuleActivityReport, { readonly kind: 'failed' }>, 'argv' | 'error'> & {
      readonly argv: readonly string[];
      readonly error: CapsuleRecordedError;
    });

export type CapsuleReportRedactionKind =
  | 'authorization-credential'
  | 'environment-value'
  | 'sensitive-argument'
  | 'sensitive-header'
  | 'sensitive-output'
  | 'private-ipc-path';

export interface CapsuleReportRedaction {
  readonly kind: CapsuleReportRedactionKind;
  readonly location: string;
}

export type CapsuleReportObservations =
  | {
      readonly kind: 'collector-session-found';
      readonly telemetry:
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
      readonly fragmentCount: number;
      readonly traceIds: readonly string[];
      readonly activations: readonly {
        readonly runtime: string;
        readonly serviceName: string;
        readonly activatedAt: string;
      }[];
    }
  | {
      readonly kind: 'collector-session-missing';
      readonly message: string;
    }
  | {
      readonly kind: 'collector-session-corrupt';
      readonly error: { readonly name: string; readonly message: string };
    };

export interface CapsuleReportDocument {
  readonly schemaVersion: 1;
  readonly kind: 'capsule-operational-report';
  readonly session: {
    readonly sessionId: string;
    readonly system: string;
    readonly title: string;
    readonly description: CapsuleDescription;
    readonly retainedState: CapsuleSessionState;
    readonly admittedAt: string;
    readonly updatedAt: string;
    readonly artifactRoot: string;
  };
  readonly lifecycle: CapsuleReportLifecycle;
  readonly composeProject: CapsuleReportAvailability<string>;
  readonly entrypoint: CapsuleReportAvailability<CapsuleEntrypoint>;
  readonly resources: {
    readonly containers: readonly CapsuleContainerDetails[];
    readonly networks: readonly string[];
    readonly volumes: readonly string[];
  };
  readonly readiness: CapsuleReportAvailability<CapsuleReadinessDetails>;
  readonly activities: readonly CapsuleReportActivity[];
  readonly progress: readonly CapsuleProgressEvent[];
  readonly observations: CapsuleReportObservations;
  readonly cleanup: CapsuleCleanupReport;
  readonly failure: CapsuleReportFailureRecord;
  readonly redactions: {
    readonly count: number;
    readonly entries: readonly CapsuleReportRedaction[];
  };
}

/** Presentation-neutral data safe for a standalone HTML renderer. */
export type CapsuleHtmlReportData = CapsuleReportDocument;

export type CapsuleReportArtifact = 'session' | 'activities' | 'progress' | 'observations';

export type CapsuleReportResult =
  | { readonly kind: 'capsule-report'; readonly document: CapsuleReportDocument }
  | CapsuleOperationFailure
  | {
      readonly kind: 'capsule-report-artifact-failed';
      readonly sessionId: string;
      readonly artifact: CapsuleReportArtifact;
      readonly error: CapsuleRecordedError;
    };

export interface CapsuleReportProjectionInput {
  readonly record: CapsuleSessionRecord;
  readonly activities: readonly CapsuleActivityReport[];
  readonly progress: readonly CapsuleProgressEvent[];
  readonly observations: CollectorSessionReadResult;
}

export interface SerializeCapsuleReportDocumentInput {
  readonly document: CapsuleReportDocument;
}
