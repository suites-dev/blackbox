import type {
  CapsuleAvailability,
  CapsuleCleanupReport,
  CapsuleContainerDetails,
  CapsuleDescription,
  CapsuleEntrypoint,
  CapsuleFailureRecord,
  CapsuleManagerOwnership,
  CapsuleReadinessDetails,
  CapsuleSessionState,
} from '../types.js';

export interface CapsuleSessionRecord {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  /** Internal resource identity. It is retained but omitted from public results. */
  readonly executionId: string;
  readonly system: string;
  readonly title: string;
  readonly description: CapsuleDescription;
  readonly state: CapsuleSessionState;
  readonly revision: number;
  readonly admittedAt: string;
  readonly updatedAt: string;
  readonly manager: CapsuleManagerOwnership;
  readonly socketPath: string;
  readonly entrypoint: CapsuleAvailability<CapsuleEntrypoint>;
  readonly containers: readonly CapsuleContainerDetails[];
  readonly cleanup: CapsuleCleanupReport;
  readonly failure: CapsuleFailureRecord;
  readonly composeProject: CapsuleAvailability<string>;
  readonly artifactRoot: string;
  readonly networks: readonly string[];
  readonly volumes: readonly string[];
  readonly readiness: CapsuleAvailability<CapsuleReadinessDetails>;
}
