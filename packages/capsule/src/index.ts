export { startCapsule } from './session/start.js';
export {
  execCapsule,
  execCapsuleInteractive,
  reportCapsule,
  stopCapsule,
} from './session/operations.js';
export { readCapsuleObservations } from './session/observations.js';
export { projectCapsuleReport } from './reporting/document.js';
export { serializeCapsuleReportDocument } from './reporting/serialization.js';
export { renderCapsuleHtml } from './reporting/html.js';
export { capsuleReportClientView } from './reporting/html/client-view.js';
export { listCapsuleSessions } from './registry/list.js';
export { capsuleConnectionEnvironment } from './connection-environment.js';
export {
  CAPSULE_ACTIVITY_NAME_MAX_LENGTH,
  normalizeCapsuleActivityName,
} from './execution/activity-name.js';
export { nodeCapsuleManagerPorts } from './manager/ports.js';
export type {
  CapsuleCatalogPort,
  CapsuleManagerPorts,
  CapsuleSandboxPort,
} from './manager/ports.js';
export type {
  CapsuleCollectorRuntime,
  CapsuleCollectorRuntimePort,
  CapsuleCollectorRuntimeReadiness,
} from './manager/collector-runtime.js';
export type { CapsuleConnectionEnvironmentInput } from './connection-environment.js';
export {
  capsuleActivityPath,
  capsuleRecordPath,
  capsuleRuntimeRoot,
  capsuleSandboxRecordDirectory,
  capsuleSessionDirectory,
  capsuleSocketPath,
  readCapsuleActivities,
  readCapsuleRecord,
} from './records.js';
export type { CapsuleSessionRecord, CapsuleSessionSelector } from './records.js';
export type {
  CapsuleActivityReport,
  CapsuleActivityName,
  CapsuleActivityPurpose,
  CapsuleAvailability,
  CapsuleCleanupReport,
  CapsuleContainerDetails,
  CapsuleDescription,
  CapsuleDriverDetails,
  CapsuleDriverOutcome,
  CapsuleEntrypoint,
  CapsuleExecutionOutcome,
  CapsuleExecutionLocation,
  CapsuleExecInput,
  CapsuleInteractiveControl,
  CapsuleInteractiveControlResult,
  CapsuleInteractiveEvent,
  CapsuleInteractiveExecInput,
  CapsuleExecResult,
  CapsuleExecTarget,
  CapsuleFailureRecord,
  CapsuleManagerOwnership,
  CapsuleOperationFailure,
  CapsuleObservationsInput,
  CapsuleObservationsResult,
  CapsuleOutputRetention,
  CapsuleProcessOutcome,
  CapsuleRawCommandOutcome,
  CapsuleProgressEvent,
  CapsuleProgressMode,
  CapsuleProgressStage,
  CapsuleReadinessDetails,
  CapsuleRecordedError,
  CapsuleReportInput,
  CapsuleSessionState,
  CapsuleStartInput,
  CapsuleStartFailureStage,
  CapsuleStartResult,
  CapsuleStopInput,
  CapsuleStopResult,
  CapsuleTerminalSize,
} from './types.js';
export type {
  CapsuleReportActivity,
  CapsuleReportArtifact,
  CapsuleReportAvailability,
  CapsuleReportDocument,
  CapsuleReportFailureRecord,
  CapsuleHtmlReportData,
  CapsuleReportLifecycle,
  CapsuleReportProjectionInput,
  CapsuleReportRedaction,
  CapsuleReportRedactionKind,
  CapsuleReportResult,
  SerializeCapsuleReportDocumentInput,
} from './reporting/types.js';
export type { CapsuleHtmlInput } from './reporting/html.js';
export type {
  CapsuleRegistryEntry,
  CapsuleRegistryInput,
  CapsuleRegistryResult,
  CapsuleSessionSummary,
} from './registry/types.js';

export type { CapsuleAcquisitionObservation } from './progress/acquisition.js';
export {
  capsuleProgressSchema,
  capsuleProgressSchemaUrl,
  type CapsuleProgressDocument,
} from './progress/schema.js';
export {
  capsuleActivitiesSchema,
  capsuleActivitiesSchemaUrl,
  capsuleOperationalReportSchema,
  capsuleOperationalReportSchemaUrl,
  capsuleSessionSchema,
  capsuleSessionSchemaUrl,
} from './schema/artifact-schemas.js';
