import type { ComposeObservationMode } from './acquisition/observation.js';
import type { SandboxProgressMode } from './acquisition/progress.js';
import type {
  ComposeResourceInspectionInput,
  ComposeResourceInspectionResult,
  SandboxResourceInspectionInput,
  SandboxResourceInspectionResult,
} from './inspection/resources.js';
import type {
  SandboxContainerExecutionInput,
  SandboxContainerExecutionStartResult,
} from './execution/streaming/types.js';
import type { SandboxTelemetryActivation } from './telemetry/types.js';

export interface SandboxEndpointRequest {
  readonly name: string;
  readonly service: string;
  readonly containerPort: number;
}

export interface SandboxInput {
  readonly sandboxId: string;
  readonly projectDirectory: string;
  readonly composeFiles: readonly string[];
  readonly recordDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly serviceSelection: SandboxServiceSelection;
  readonly endpoints: readonly SandboxEndpointRequest[];
  readonly startupTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly telemetry: SandboxTelemetryInput;
}

export type SandboxTelemetryInput =
  | { readonly kind: 'disabled' }
  | SandboxTelemetryEnabledInput;

export interface SandboxTelemetryEnabledInput {
  readonly kind: 'enabled';
  readonly sessionId: string;
  readonly executionId: string;
  readonly authorization: {
    readonly kind: 'split-bearer-tokens';
    readonly ingestToken: string;
    readonly controlToken: string;
  };
  readonly collector: SandboxCollectorInput;
  readonly participants: readonly SandboxTelemetryParticipant[];
}

export interface SandboxCollectorInput {
  readonly service: string;
  readonly containerPort: number;
  readonly runtime: SandboxCollectorRuntime;
  readonly environment: Readonly<Record<string, string>>;
  readonly readiness: {
    readonly kind: 'http';
    readonly path: string;
    readonly intervalSeconds: number;
    readonly timeoutSeconds: number;
    readonly retries: number;
  };
  readonly drain: { readonly kind: 'signal'; readonly signal: 'SIGTERM' };
}

export type SandboxCollectorRuntime =
  | { readonly kind: 'image-default'; readonly image: string }
  | {
      readonly kind: 'mounted-node';
      readonly image: string;
      readonly sourceDirectory: string;
      readonly targetDirectory: string;
      readonly entrypoint: string;
      readonly user: string;
    };

export interface SandboxTelemetryMount {
  readonly source: string;
  readonly target: string;
  readonly access: 'read-only';
}

export interface SandboxTelemetryParticipant {
  readonly service: string;
  readonly runtime: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly activation: SandboxTelemetryActivation;
  readonly mounts: readonly SandboxTelemetryMount[];
}

export interface SandboxStartInput {
  readonly sandbox: SandboxInput;
  readonly progress: SandboxProgressMode;
}

export type SandboxServiceSelection =
  | { readonly kind: 'selected'; readonly services: readonly string[] }
  | { readonly kind: 'all'; readonly declaredServices: readonly string[] };

export interface SandboxContainerSelector {
  readonly service: string;
}

export interface SandboxMappedPortSelector {
  readonly containerPort: number;
}

export interface SandboxStopInput {
  readonly reason: SandboxStopReason;
}

export interface SandboxContainerExecInput {
  readonly kind: 'container-exec';
  readonly service: string;
  readonly argv: readonly [string, ...string[]];
}

export type SandboxExecuteInput = SandboxContainerExecInput;

export type SandboxExecutionOutput =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'captured';
      readonly stdout: string;
      readonly stderr: string;
      readonly combined: string;
    };

export type SandboxExecutionFailure =
  | { readonly kind: 'unknown-service'; readonly service: string }
  | { readonly kind: 'invalid-argv'; readonly reason: 'empty' }
  | {
      readonly kind: 'sandbox-not-running';
      readonly state: 'stopping' | 'completed' | 'stop-failed';
    }
  | {
      readonly kind: 'runtime-error';
      readonly error: { readonly name: string; readonly message: string };
      readonly output: SandboxExecutionOutput;
    };

export type SandboxExecuteResult =
  | {
      readonly kind: 'exited';
      readonly service: string;
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly combined: string;
    }
  | { readonly kind: 'execution-failed'; readonly failure: SandboxExecutionFailure };

export interface SandboxEndpoint {
  readonly name: string;
  readonly service: string;
  readonly containerPort: number;
  readonly host: string;
  readonly port: number;
}

export interface SandboxContainer {
  readonly service: string;
  readonly testcontainer: SandboxTestcontainerInspection;
}

export interface SandboxTestcontainerInspection {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly labels: Readonly<Record<string, string>>;
  /** Effective environment reported by Docker for this exact owned container. */
  readonly environment: Readonly<Record<string, string>>;
  readonly networkNames: readonly string[];
  /** Ports explicitly requested by the caller, keyed by container port. */
  readonly mappedPorts: ReadonlyMap<number, number>;
  getMappedPort(input: SandboxMappedPortSelector): number;
}

export type SandboxLifecycleState =
  | 'admitted'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'start-failed'
  | 'stop-failed';

export interface SandboxLifecycleEvent {
  readonly sandboxId: string;
  readonly projectName: string;
  readonly state: SandboxLifecycleState;
  readonly revision: number;
  readonly at: string;
}

export type SandboxStopReason = 'completed' | 'cancelled' | 'failed' | 'interrupted';

export interface SandboxStopResult {
  readonly kind: 'stopped';
  readonly sandboxId: string;
  readonly reason: SandboxStopReason;
  readonly cleanup: 'complete';
}

export interface SandboxHandle {
  readonly sandboxId: string;
  readonly projectName: string;
  readonly state: 'running' | 'stopping' | 'completed' | 'stop-failed';
  /** Compose substitution environment supplied by the caller, not image-internal environment. */
  readonly declaredEnvironment: Readonly<Record<string, string>>;
  readonly endpoints: ReadonlyMap<string, SandboxEndpoint>;
  readonly containers: ReadonlyMap<string, SandboxContainer>;
  readonly telemetry: SandboxTelemetryStatus;
  getContainer(input: SandboxContainerSelector): SandboxContainer;
  inspectResources(input: SandboxResourceInspectionInput): SandboxResourceInspectionResult;
  execute(input: SandboxExecuteInput): Promise<SandboxExecuteResult>;
  startContainerExecution(
    input: SandboxContainerExecutionInput,
  ): Promise<SandboxContainerExecutionStartResult>;
  inspectTelemetry(): Promise<SandboxTelemetryStatus>;
  stop(input: SandboxStopInput): Promise<SandboxStopResult>;
}

export type SandboxTelemetryStatus =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'available'; readonly endpoints: SandboxTelemetryEndpoints }
  | {
      readonly kind: 'unavailable';
      readonly endpoints: SandboxTelemetryEndpoints;
      readonly error: { readonly name: string; readonly message: string };
    };

export interface SandboxTelemetryEndpoints {
  readonly baseUrl: string;
  readonly tracesUrl: string;
  readonly activationUrl: string;
  readonly readUrl: string;
}

export interface ComposeContainer {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly environment: Readonly<Record<string, string>>;
  readonly networkNames: readonly string[];
  getMappedPort(input: SandboxMappedPortSelector): number;
}

export interface StartedComposeSandbox {
  getContainer(input: SandboxContainerSelector): ComposeContainer;
  execute(input: SandboxContainerExecInput): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly combined: string;
  }>;
  inspectResources(input: ComposeResourceInspectionInput): Promise<ComposeResourceInspectionResult>;
  inspectTelemetry(): Promise<SandboxTelemetryStatus>;
  prepareStop(input: { readonly timeoutMs: number }): Promise<void>;
  stop(input: { readonly timeoutMs: number }): Promise<void>;
}

export interface ComposeStartRequest {
  readonly observation: ComposeObservationMode;
  readonly projectDirectory: string;
  readonly composeFiles: readonly string[];
  readonly projectName: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly serviceSelection: SandboxServiceSelection;
  readonly startupTimeoutMs: number;
  readonly endpoints: readonly SandboxEndpointRequest[];
  readonly telemetry: SandboxTelemetryInput;
  readonly generatedComposeDirectory: string;
}

export interface ComposeSandboxDriver {
  start(request: ComposeStartRequest): Promise<StartedComposeSandbox>;
}

export interface SandboxRuntimeDependencies {
  readonly driver: ComposeSandboxDriver;
  readonly now: () => Date;
  readonly onEvent: (event: SandboxLifecycleEvent) => void;
}
