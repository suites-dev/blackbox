export type SandboxLifecycleState =
  'admitted' | 'starting' | 'running' | 'stopping' | 'completed' | 'start-failed' | 'stop-failed';

export interface SandboxLifecycleEvent {
  readonly sandboxId: string;
  readonly projectName: string;
  readonly state: SandboxLifecycleState;
  readonly revision: number;
  readonly at: string;
}
