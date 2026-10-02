import type { SandboxProgressMode } from '../acquisition/progress.js';
import type { SandboxTelemetryInput } from './telemetry.js';

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

export interface SandboxStartInput {
  readonly sandbox: SandboxInput;
  readonly progress: SandboxProgressMode;
}

export type SandboxServiceSelection =
  | { readonly kind: 'selected'; readonly services: readonly string[] }
  | { readonly kind: 'all'; readonly declaredServices: readonly string[] };
