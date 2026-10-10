export { startCapsule } from './session/start.js';
export {
  execCapsule,
  execCapsuleInteractive,
  reportCapsule,
  stopCapsule,
} from './session/operations.js';
export {
  checkCapsuleParticipants,
  type CapsuleParticipantCheck,
  type CapsuleParticipantExit,
} from './session/participants.js';
export {
  readCapsuleLifecycle,
  readCapsuleObservations,
  readCapsuleTraces,
} from './session/observations.js';
export { projectCapsuleReport } from './reporting/document.js';
export { causalityFromTraces } from './reporting/causality/core.js';
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
export type { CapsuleActivityReport } from './model/execution/activity.js';
export type {
  CapsuleActivityName,
  CapsuleActivityPurpose,
} from './model/execution/activity-label.js';
export type {
  CapsuleAvailability,
  CapsuleCleanupReport,
  CapsuleDescription,
  CapsuleFailureRecord,
  CapsuleManagerOwnership,
} from './model/lifecycle.js';
export type {
  CapsuleContainerDetails,
  CapsuleEntrypoint,
  CapsuleReadinessDetails,
} from './model/environment.js';
export type {
  CapsuleDriverDetails,
  CapsuleDriverOutcome,
  CapsuleExecutionOutcome,
  CapsuleRawCommandOutcome,
} from './model/execution/outcome.js';
export type {
  CapsuleExecutionLocation,
  CapsuleOutputRetention,
  CapsuleProcessOutcome,
} from './model/execution/process-outcome.js';
export type {
  CapsuleExecInput,
  CapsuleInteractiveExecInput,
  CapsuleExecResult,
  CapsuleExecTarget,
  CapsuleObservationsInput,
  CapsuleObservationsResult,
  CapsuleReportInput,
  CapsuleStartInput,
  CapsuleStartResult,
  CapsuleStopInput,
  CapsuleStopResult,
} from './model/operations.js';
export type {
  CapsuleInteractiveControl,
  CapsuleInteractiveControlResult,
  CapsuleInteractiveEvent,
  CapsuleTerminalSize,
} from './model/execution/interaction.js';
export type { CapsuleOperationFailure } from './model/failure.js';
export type {
  CapsuleProgressEvent,
  CapsuleProgressMode,
  CapsuleProgressStage,
  CapsuleStartFailureStage,
} from './progress/events.js';
export type { CapsuleRecordedError } from './model/recorded-error.js';
export type { CapsuleSessionState } from './model/session-state.js';
export type {
  CapsuleReportActivity,
  CapsuleReportArtifact,
  CapsuleReportAvailability,
  CapsuleReportBody,
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
export type {
  CapsuleReportActivityCausality,
  CapsuleReportCausality,
  CapsuleReportCausedTrace,
  CapsuleReportEvidence,
  CapsuleReportLimitation,
  CapsuleReportStatus,
  CapsuleReportUncausedTrace,
  TraceSpans,
} from './reporting/causality/types.js';
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
export * from './investigation/index.js';
