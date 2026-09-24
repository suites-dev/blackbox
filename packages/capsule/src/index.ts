export { startCapsule } from './session/start.js';
export { execCapsule, reportCapsule, stopCapsule } from './session/operations.js';
export { readCapsuleObservations } from './session/observations.js';
export { projectCapsuleReport } from './reporting/document.js';
export { serializeCapsuleReportDocument } from './reporting/serialization.js';
export { renderCapsuleHtml } from './reporting/html.js';
export { capsuleReportClientView } from './reporting/html/client-view.js';
export { listCapsuleSessions } from './registry/list.js';
export { capsuleConnectionEnvironment } from './connection-environment.js';
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
  CapsuleAvailability,
  CapsuleCleanupReport,
  CapsuleClientOutcome,
  CapsuleContainerDetails,
  CapsuleDescription,
  CapsuleEntrypoint,
  CapsuleExecutionOutcome,
  CapsuleExecInput,
  CapsuleExecResult,
  CapsuleExecTarget,
  CapsuleFailureRecord,
  CapsuleManagerOwnership,
  CapsuleOperationFailure,
  CapsuleObservationsInput,
  CapsuleObservationsResult,
  CapsuleProcessOutcome,
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
