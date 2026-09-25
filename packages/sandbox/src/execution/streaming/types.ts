export type SandboxContainerTerminal =
  | { readonly kind: 'captured' }
  | { readonly kind: 'tty'; readonly columns: number; readonly rows: number };

export interface SandboxContainerExecutionInput {
  readonly kind: 'container-stream-exec';
  readonly service: string;
  readonly argv: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
  readonly terminal: SandboxContainerTerminal;
  readonly onOutput: (event: SandboxContainerOutputEvent) => void;
}

export type SandboxContainerOutputEvent =
  | { readonly kind: 'stdout'; readonly chunk: Uint8Array }
  | { readonly kind: 'stderr'; readonly chunk: Uint8Array }
  | { readonly kind: 'terminal-output'; readonly chunk: Uint8Array };

export type SandboxContainerExecutionFailure =
  | { readonly kind: 'unknown-service'; readonly service: string }
  | { readonly kind: 'invalid-argv'; readonly reason: 'empty' }
  | {
      readonly kind: 'invalid-terminal-size';
      readonly columns: number;
      readonly rows: number;
    }
  | {
      readonly kind: 'sandbox-not-running';
      readonly state: 'stopping' | 'completed' | 'stop-failed';
    }
  | {
      readonly kind: 'executable-not-found';
      readonly service: string;
      readonly executable: string;
      readonly error: SandboxContainerExecutionError;
    }
  | {
      readonly kind: 'runtime-error';
      readonly phase: 'create' | 'start' | 'stream' | 'inspect';
      readonly error: SandboxContainerExecutionError;
    };

export interface SandboxContainerExecutionError {
  readonly name: string;
  readonly message: string;
}

export type SandboxContainerExecutionOutcome =
  | { readonly kind: 'exited'; readonly service: string; readonly exitCode: number }
  | { readonly kind: 'execution-failed'; readonly failure: SandboxContainerExecutionFailure };

export type SandboxContainerExecutionStartResult =
  | { readonly kind: 'started'; readonly execution: SandboxContainerExecution }
  | { readonly kind: 'execution-failed'; readonly failure: SandboxContainerExecutionFailure };

export interface SandboxContainerExecution {
  readonly completion: Promise<SandboxContainerExecutionOutcome>;
  writeStdin(input: SandboxContainerStdinChunk): Promise<SandboxContainerControlResult>;
  endStdin(): Promise<SandboxContainerControlResult>;
  resize(input: SandboxContainerResizeInput): Promise<SandboxContainerControlResult>;
  signal(input: SandboxContainerSignalInput): Promise<SandboxContainerControlResult>;
}

export interface SandboxContainerStdinChunk {
  readonly kind: 'stdin-chunk';
  readonly chunk: Uint8Array;
}

export interface SandboxContainerResizeInput {
  readonly columns: number;
  readonly rows: number;
}

export interface SandboxContainerSignalInput {
  readonly signal: 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGKILL';
}

export type SandboxContainerControlResult =
  | {
      readonly kind: 'delivered';
      readonly action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal';
      readonly mechanism: 'docker-stream' | 'docker-exec-resize' | 'tty-control-character';
    }
  | {
      readonly kind: 'unsupported';
      readonly action: 'resize' | 'signal';
      readonly reason: 'tty-required' | 'docker-exec-signal-unsupported';
    }
  | {
      readonly kind: 'rejected';
      readonly action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal';
      readonly reason: 'execution-completed' | 'stdin-ended' | 'invalid-terminal-size';
    }
  | {
      readonly kind: 'failed';
      readonly action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal';
      readonly error: SandboxContainerExecutionError;
    };
