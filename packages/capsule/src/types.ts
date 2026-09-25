import type { CapsuleAcquisitionObservation } from './progress/acquisition.js';

export interface CapsuleStartInput {
  readonly projectDirectory: string;
  readonly systemId: string;
  readonly title: string;
  readonly description: CapsuleDescription;
  readonly environment: Readonly<Record<string, string>>;
  readonly progress: CapsuleProgressMode;
}

export type CapsuleDescription =
  | { readonly kind: 'provided'; readonly value: string }
  | { readonly kind: 'omitted' };

export type CapsuleAvailability<Value> =
  | { readonly kind: 'available'; readonly value: Value }
  | { readonly kind: 'unavailable' };

export type CapsuleManagerOwnership =
  | { readonly kind: 'not-started' }
  | { readonly kind: 'started'; readonly pid: number };

export type CapsuleFailureRecord =
  | { readonly kind: 'none' }
  | { readonly kind: 'recorded'; readonly error: CapsuleRecordedError };

export type CapsuleProgressMode =
  | { readonly kind: 'silent' }
  | { readonly kind: 'interactive'; readonly sink: (event: CapsuleProgressEvent) => void }
  | { readonly kind: 'non-interactive'; readonly sink: (event: CapsuleProgressEvent) => void };

export type CapsuleProgressStage =
  | 'admission'
  | 'catalog'
  | 'manager'
  | 'acquisition'
  | 'readiness'
  | 'ready'
  | 'catalog-load'
  | 'catalog-resolution'
  | 'manager-spawn'
  | 'manager-handshake'
  | 'persistence';

interface CapsuleProgressBase {
  readonly sessionId: string;
  readonly sequence: number;
  readonly at: string;
  readonly stage: CapsuleProgressStage;
}

export type CapsuleStartFailureStage =
  | 'admission'
  | 'catalog-load'
  | 'catalog-resolution'
  | 'manager-spawn'
  | 'manager-handshake'
  | 'acquisition'
  | 'readiness'
  | 'persistence';

export type CapsuleProgressEvent =
  | (CapsuleProgressBase & {
      readonly kind: 'session-admitted';
      readonly system: string;
      readonly artifactRoot: string;
      readonly environmentKeys: readonly string[];
    })
  | (CapsuleProgressBase & { readonly kind: 'manager-spawned'; readonly managerPid: number })
  | (CapsuleProgressBase & { readonly kind: 'manager-ready'; readonly managerPid: number })
  | (CapsuleProgressBase & {
      readonly kind: 'catalog-selected';
      readonly system: string;
      readonly configFile: string;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'catalog-resolved';
      readonly system: string;
      readonly projectDirectory: string;
      readonly composeFiles: readonly string[];
      readonly services: readonly string[];
    })
  | (CapsuleProgressBase & { readonly kind: 'compose-configured'; readonly projectName: string })
  | (CapsuleProgressBase & { readonly kind: 'acquisition-started'; readonly projectName: string })
  | (CapsuleProgressBase & {
      readonly kind: 'acquisition-observation';
      readonly observation: CapsuleAcquisitionObservation;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'container-acquired';
      readonly participant: string;
      readonly service: string;
      readonly containerName: string;
      readonly containerId: string;
      readonly networkNames: readonly string[];
    })
  | (CapsuleProgressBase & {
      readonly kind: 'endpoint-mapped';
      readonly endpoint: CapsuleEntrypoint;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'resource-owned';
      readonly resource:
        | { readonly kind: 'network'; readonly name: string }
        | { readonly kind: 'volume'; readonly name: string };
    })
  | (CapsuleProgressBase & {
      readonly kind: 'readiness-started';
      readonly url: string;
      readonly timeoutMs: number;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'readiness-succeeded';
      readonly url: string;
      readonly durationMs: number;
    })
  | (CapsuleProgressBase & { readonly kind: 'capsule-ready'; readonly durationMs: number })
  | (CapsuleProgressBase & {
      readonly kind: 'capsule-start-failed';
      readonly stage: CapsuleStartFailureStage;
      readonly cause: CapsuleRecordedError;
    });

export interface CapsuleEntrypoint {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
}

export interface CapsuleContainerDetails {
  readonly participant: string;
  readonly service: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly host: string;
  readonly networkNames: readonly string[];
}

export interface CapsuleReadinessDetails {
  readonly url: string;
  readonly status: 'ready';
  readonly durationMs: number;
}

export type CapsuleStartResult =
  | {
      readonly kind: 'capsule-started';
      readonly sessionId: string;
      readonly system: string;
      readonly title: string;
      readonly composeProject: string;
      readonly artifactRoot: string;
      readonly entrypoint: CapsuleEntrypoint;
      readonly containers: readonly CapsuleContainerDetails[];
      readonly networks: readonly string[];
      readonly volumes: readonly string[];
      readonly readiness: CapsuleReadinessDetails;
    }
  | CapsuleOperationFailure;

export interface CapsuleStopInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly reason: 'completed' | 'cancelled' | 'failed' | 'interrupted';
}

export type CapsuleStopResult =
  | {
      readonly kind: 'capsule-stopped';
      readonly sessionId: string;
      readonly cleanup: 'complete';
      readonly alreadyStopped: boolean;
    }
  | CapsuleOperationFailure;

export interface CapsuleReportInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
}

export type {
  CapsuleActivityReport,
  CapsuleActivityName,
  CapsuleActivityPurpose,
  CapsuleDriverDetails,
  CapsuleDriverOutcome,
  CapsuleExecInput,
  CapsuleInteractiveControl,
  CapsuleInteractiveControlResult,
  CapsuleInteractiveEvent,
  CapsuleInteractiveExecInput,
  CapsuleExecResult,
  CapsuleExecTarget,
  CapsuleExecutionInteraction,
  CapsuleExecutionOutcome,
  CapsuleExecutionLocation,
  CapsuleObservationsInput,
  CapsuleObservationsResult,
  CapsuleOutputRetention,
  CapsuleProcessOutcome,
  CapsuleRawCommandOutcome,
  CapsuleTerminalSize,
} from './execution/types.js';

export type CapsuleCleanupReport =
  | { readonly kind: 'not-attempted' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: CapsuleRecordedError };

export interface CapsuleRecordedError {
  readonly name: string;
  readonly message: string;
}

export type CapsuleOperationFailure =
  | {
      readonly kind: 'capsule-not-found';
      readonly sessionId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'capsule-invalid-state';
      readonly sessionId: string;
      readonly state: CapsuleSessionState;
      readonly message: string;
    }
  | {
      readonly kind: 'capsule-operation-failed';
      readonly operation: 'start' | 'exec' | 'stop' | 'report' | 'observations';
      readonly sessionId: string;
      readonly error: CapsuleRecordedError;
    };

export type CapsuleSessionState =
  | 'admitted'
  | 'manager-starting'
  | 'sandbox-starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'start-failed'
  | 'stop-failed'
  | 'manager-failed';
