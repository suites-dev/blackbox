import type { ComposeObservationMode } from './acquisition/observation.js';
import type { SandboxProgressMode } from './acquisition/progress.js';
import type {
  ComposeResourceInspectionInput,
  ComposeResourceInspectionResult,
  SandboxResourceInspectionInput,
  SandboxResourceInspectionResult,
} from './inspection/resources.js';

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
  getContainer(input: SandboxContainerSelector): SandboxContainer;
  inspectResources(input: SandboxResourceInspectionInput): SandboxResourceInspectionResult;
  execute(input: SandboxExecuteInput): Promise<SandboxExecuteResult>;
  stop(input: SandboxStopInput): Promise<SandboxStopResult>;
}

export interface ComposeContainer {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly labels: Readonly<Record<string, string>>;
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
}

export interface ComposeSandboxDriver {
  start(request: ComposeStartRequest): Promise<StartedComposeSandbox>;
}

export interface SandboxRuntimeDependencies {
  readonly driver: ComposeSandboxDriver;
  readonly now: () => Date;
  readonly onEvent: (event: SandboxLifecycleEvent) => void;
}
