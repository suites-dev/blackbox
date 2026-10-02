import type {
  SandboxContainerExecutionInput,
  SandboxContainerExecutionStartResult,
} from '../execution/streaming/types.js';
import type {
  SandboxResourceInspectionInput,
  SandboxResourceInspectionResult,
} from '../inspection/resources.js';
import type { SandboxContainer } from '../inspection/sandbox-container.js';

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

export interface SandboxContainerSelector {
  readonly service: string;
}

export interface SandboxEndpoint {
  readonly name: string;
  readonly service: string;
  readonly containerPort: number;
  readonly host: string;
  readonly port: number;
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

export interface SandboxStopInput {
  readonly reason: SandboxStopReason;
}

export type SandboxStopReason = 'completed' | 'cancelled' | 'failed' | 'interrupted';

export interface SandboxStopResult {
  readonly kind: 'stopped';
  readonly sandboxId: string;
  readonly reason: SandboxStopReason;
  readonly cleanup: 'complete';
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
