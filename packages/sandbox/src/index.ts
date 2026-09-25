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
export {
  decodeSandboxRecord,
  SandboxRecordValidationError,
} from './ownership/record-decoder.js';
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
  SandboxContainer,
  SandboxContainerSelector,
  SandboxEndpoint,
  SandboxEndpointRequest,
  SandboxContainerExecInput,
  SandboxExecuteInput,
  SandboxExecuteResult,
  SandboxExecutionFailure,
  SandboxExecutionOutput,
  SandboxHandle,
  SandboxInput,
  SandboxLifecycleEvent,
  SandboxLifecycleState,
  SandboxMappedPortSelector,
  SandboxRuntimeDependencies,
  SandboxServiceSelection,
  SandboxStartInput,
  SandboxStopInput,
  SandboxStopReason,
  SandboxStopResult,
  SandboxTestcontainerInspection,
  StartedComposeSandbox,
  SandboxCollectorInput,
  SandboxCollectorRuntime,
  SandboxTelemetryEnabledInput,
  SandboxTelemetryEndpoints,
  SandboxTelemetryInput,
  SandboxTelemetryMount,
  SandboxTelemetryParticipant,
  SandboxTelemetryStatus,
} from './types.js';
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
  ComposeServiceObservation,
  ComposeObservationMode,
} from './acquisition/observation.js';
