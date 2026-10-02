import type { SandboxTelemetryActivation } from '../telemetry/types.js';

export type SandboxTelemetryInput = { readonly kind: 'disabled' } | SandboxTelemetryEnabledInput;

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
