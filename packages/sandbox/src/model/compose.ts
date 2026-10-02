import type { ComposeObservationMode } from '../acquisition/observation.js';
import type {
  ComposeResourceInspectionInput,
  ComposeResourceInspectionResult,
} from '../inspection/resources.js';
import type { SandboxMappedPortSelector } from '../inspection/sandbox-container.js';
import type {
  SandboxContainerExecInput,
  SandboxContainerSelector,
  SandboxTelemetryStatus,
} from './handle.js';
import type { SandboxEndpointRequest, SandboxServiceSelection } from './input.js';
import type { SandboxLifecycleEvent } from './lifecycle.js';
import type { SandboxTelemetryInput } from './telemetry.js';

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
