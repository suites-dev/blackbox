import type {
  CompletedSandboxRecord,
  RecordedError,
  SandboxRecord,
  StartFailedSandboxRecord,
  StopFailedSandboxRecord,
} from '../ownership/records.js';

export interface RecoverSandboxInput {
  readonly recordDirectory: string;
  readonly sandboxId: string;
  readonly timeoutMs: number;
}

export type SandboxRecoveryResult =
  | {
      readonly kind: 'sandbox-recovery-not-required';
      readonly reason: 'record-not-found';
      readonly record: { readonly kind: 'unavailable' };
    }
  | {
      readonly kind: 'sandbox-recovery-not-required';
      readonly reason: 'already-clean';
      readonly record: { readonly kind: 'available'; readonly value: SandboxRecord };
    }
  | {
      readonly kind: 'sandbox-recovered';
      readonly record: CompletedSandboxRecord | StartFailedSandboxRecord;
    }
  | {
      readonly kind: 'sandbox-recovery-failed';
      readonly record: StopFailedSandboxRecord;
      readonly error: RecordedError;
    };

export interface OwnedComposeCleanupInput {
  readonly projectName: string;
  readonly timeoutMs: number;
}

export interface SandboxRecoveryPorts {
  readonly now: () => Date;
  readonly readRecord: (input: {
    readonly recordDirectory: string;
    readonly sandboxId: string;
  }) => Promise<SandboxRecord>;
  readonly writeRecord: (input: {
    readonly recordDirectory: string;
    readonly record: SandboxRecord;
  }) => Promise<void>;
  readonly cleanupOwnedComposeProject: (input: OwnedComposeCleanupInput) => Promise<void>;
}

export interface RecoveryResource {
  readonly id: string;
  readonly labels:
    | { readonly kind: 'available'; readonly values: Readonly<Record<string, string>> }
    | { readonly kind: 'unavailable' };
}

export interface ComposeRecoveryClient {
  readonly listContainers: (input: { readonly projectName: string }) => Promise<readonly string[]>;
  readonly inspectContainer: (input: { readonly id: string }) => Promise<{
    readonly id: string;
    readonly running: boolean;
    readonly labels: RecoveryResource['labels'];
  }>;
  readonly stopContainer: (input: {
    readonly id: string;
    readonly timeoutSeconds: number;
  }) => Promise<void>;
  readonly removeContainer: (input: {
    readonly id: string;
    readonly removeAttachedVolumes: true;
  }) => Promise<void>;
  readonly listNetworks: (input: { readonly projectName: string }) => Promise<readonly string[]>;
  readonly inspectNetwork: (input: { readonly id: string }) => Promise<RecoveryResource>;
  readonly removeNetwork: (input: { readonly id: string }) => Promise<void>;
  readonly listVolumes: (input: { readonly projectName: string }) => Promise<readonly string[]>;
  readonly inspectVolume: (input: { readonly id: string }) => Promise<RecoveryResource>;
  readonly removeVolume: (input: { readonly id: string }) => Promise<void>;
}
