export {
  SandboxRuntime,
  SandboxStartError,
  SandboxStopError,
  composeProjectName,
  createSandboxRuntime,
  startSandbox,
  type CleanupOutcome,
  type RecordWriteOutcome,
  type SandboxStartFailure,
  type SandboxStopFailure,
} from './sandbox.js';
export {
  admitSandboxRecord,
  findInterruptedSandboxes,
  readSandboxRecord,
  sandboxRecordPath,
  type ActiveSandboxRecord,
  type CompletedSandboxRecord,
  type CleanupRecord,
  type FailedSandboxRecord,
  type InterruptedSandboxRecord,
  type RecordedError,
  type SandboxRecord,
  type SandboxRecordSelector,
  type SandboxRecordWriteInput,
  type StartFailedSandboxRecord,
  type StopFailedSandboxRecord,
} from './ownership/records.js';
export { replaceFile } from './ownership/replace-file.js';
export {
  decodeSandboxRecord,
  SandboxRecordValidationError,
} from './ownership/record-decoder.js';
export { recoverSandbox } from './recovery/recover.js';
export type {
  RecoverSandboxInput,
  SandboxRecoveryResult,
} from './recovery/types.js';
export {
  sandboxRecordSchema,
  sandboxRecordSchemaUrl,
} from './schema/sandbox-record-schema.js';
export { TestcontainersComposeDriver } from './acquisition/testcontainers-driver.js';
export {
  type SandboxProgressEvent,
  type SandboxProgressMode,
  type SandboxProgressSink,
} from './acquisition/progress.js';
export type {
  ComposeNetworkResource,
  ComposeResourceInspectionInput,
  ComposeResourceInspectionResult,
  ComposeVolumeResource,
  SandboxNetworkResource,
  SandboxResourceInspectionInput,
  SandboxResourceInspectionResult,
  SandboxVolumeResource,
} from './inspection/resources.js';
export { SandboxInputError, validateSandboxInput } from './validation/input.js';
export {
  sandboxGeneratedComposeDirectory,
  sandboxTelemetryStorageDirectory,
} from './telemetry/storage.js';
export type {
  ComposeContainer,
  ComposeSandboxDriver,
  ComposeStartRequest,
  SandboxRuntimeDependencies,
  StartedComposeSandbox,
} from './model/compose.js';
export type {
  SandboxContainer,
  SandboxMappedPortSelector,
  SandboxTestcontainerInspection,
} from './inspection/sandbox-container.js';
export type {
  SandboxContainerSelector,
  SandboxEndpoint,
  SandboxContainerExecInput,
  SandboxExecuteInput,
  SandboxExecuteResult,
  SandboxExecutionFailure,
  SandboxExecutionOutput,
  SandboxHandle,
  SandboxStopInput,
  SandboxStopReason,
  SandboxStopResult,
  SandboxTelemetryEndpoints,
  SandboxTelemetryStatus,
} from './model/handle.js';
export type {
  SandboxEndpointRequest,
  SandboxInput,
  SandboxServiceSelection,
  SandboxStartInput,
} from './model/input.js';
export type { SandboxLifecycleEvent, SandboxLifecycleState } from './model/lifecycle.js';
export type {
  SandboxCollectorInput,
  SandboxCollectorRuntime,
  SandboxTelemetryEnabledInput,
  SandboxTelemetryInput,
  SandboxTelemetryMount,
  SandboxTelemetryParticipant,
} from './model/telemetry.js';
export type {
  SandboxContainerControlResult,
  SandboxContainerExecution,
  SandboxContainerExecutionError,
  SandboxContainerExecutionFailure,
  SandboxContainerExecutionInput,
  SandboxContainerExecutionOutcome,
  SandboxContainerExecutionStartResult,
  SandboxContainerOutputEvent,
  SandboxContainerResizeInput,
  SandboxContainerSignalInput,
  SandboxContainerStdinChunk,
  SandboxContainerTerminal,
} from './execution/streaming/types.js';

export type {
  ComposeAcquisitionObservation,
  ComposeAwaitedEndpoint,
  ComposeServiceObservation,
  ComposeObservationMode,
  ComposeObservationSnapshot,
} from './acquisition/observation.js';
export { inspectComposeProject } from './acquisition/observation/project-inspection.js';
