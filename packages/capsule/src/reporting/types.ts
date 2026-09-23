import type {
  CapsuleActivityReport,
  CapsuleCleanupReport,
  CapsuleContainerDetails,
  CapsuleEntrypoint,
  CapsuleOperationFailure,
  CapsuleProcessOutcome,
  CapsuleProgressEvent,
  CapsuleReadinessDetails,
  CapsuleRecordedError,
  CapsuleSessionState,
} from '../types.js';
import type { CapsuleSessionRecord } from '../records.js';

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

export type CapsuleReportAvailability<Value> =
  | { readonly kind: 'available'; readonly value: Value }
  | { readonly kind: 'unavailable' };

export type CapsuleReportFailureRecord =
  | { readonly kind: 'none' }
  | { readonly kind: 'recorded'; readonly error: CapsuleRecordedError };

export interface CapsuleReportActivity extends Omit<CapsuleActivityReport, 'argv' | 'outcome'> {
  readonly argv: readonly string[];
  readonly outcome: CapsuleProcessOutcome;
}

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

export interface CapsuleReportDocument {
  readonly schemaVersion: 1;
  readonly kind: 'capsule-operational-report';
  readonly session: {
    readonly sessionId: string;
    readonly system: string;
    readonly title: string;
    readonly description: string | undefined;
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
  readonly cleanup: CapsuleCleanupReport;
  readonly failure: CapsuleReportFailureRecord;
  readonly redactions: { readonly count: number; readonly entries: readonly CapsuleReportRedaction[] };
}

/** Presentation-neutral data safe for a standalone HTML renderer. */
export type CapsuleHtmlReportData = CapsuleReportDocument;

export type CapsuleReportArtifact = 'session' | 'activities' | 'progress';

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
}

export interface SerializeCapsuleReportDocumentInput {
  readonly document: CapsuleReportDocument;
}
