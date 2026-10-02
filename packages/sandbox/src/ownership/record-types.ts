import type { SandboxLifecycleState, SandboxStopReason } from '../types.js';

export interface RecordedError {
  readonly name: string;
  readonly message: string;
}

interface SandboxRecordBase {
  readonly schemaVersion: 1;
  readonly sandboxId: string;
  readonly projectName: string;
  readonly composeFiles: readonly string[];
  readonly state: SandboxLifecycleState;
  readonly revision: number;
  readonly admittedAt: string;
  readonly updatedAt: string;
}

export interface ActiveSandboxRecord extends SandboxRecordBase {
  readonly state: 'admitted' | 'starting' | 'running' | 'stopping';
}

export interface CompletedSandboxRecord extends SandboxRecordBase {
  readonly state: 'completed';
  readonly stopReason: SandboxStopReason;
  readonly cleanup: 'complete';
}

export type CleanupRecord =
  | { readonly kind: 'not-attempted' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: RecordedError };

export interface StartFailedSandboxRecord extends SandboxRecordBase {
  readonly state: 'start-failed';
  readonly primaryError: RecordedError;
  readonly cleanup: CleanupRecord;
}

export interface StopFailedSandboxRecord extends SandboxRecordBase {
  readonly state: 'stop-failed';
  readonly primaryError: RecordedError;
  readonly cleanup: { readonly kind: 'failed'; readonly error: RecordedError };
}

export type FailedSandboxRecord = StartFailedSandboxRecord | StopFailedSandboxRecord;
export type SandboxRecord = ActiveSandboxRecord | CompletedSandboxRecord | FailedSandboxRecord;

export interface InterruptedSandboxRecord {
  readonly status: 'interrupted';
  readonly record: ActiveSandboxRecord;
}
