import type { CapsuleRecordedError } from '../recorded-error.js';

export interface CapsuleTerminalSize {
  readonly columns: number;
  readonly rows: number;
}

export type CapsuleInteractiveControl =
  | {
      readonly kind: 'stdin-chunk';
      readonly controlId: string;
      readonly chunk: Uint8Array;
    }
  | { readonly kind: 'stdin-end'; readonly controlId: string }
  | {
      readonly kind: 'resize';
      readonly controlId: string;
      readonly size: CapsuleTerminalSize;
    }
  | {
      readonly kind: 'signal';
      readonly controlId: string;
      readonly signal: 'SIGINT' | 'SIGQUIT';
    };

export type CapsuleExecutionControl =
  CapsuleInteractiveControl | { readonly kind: 'force-terminate'; readonly controlId: string };

export type CapsuleInteractiveControlResult =
  | {
      readonly kind: 'delivered';
      readonly action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal';
      readonly mechanism:
        | 'host-process-stdin'
        | 'host-process-signal'
        | 'docker-stream'
        | 'docker-stream-abort'
        | 'docker-exec-resize'
        | 'tty-control-character';
    }
  | {
      readonly kind: 'unsupported';
      readonly action: 'resize' | 'signal';
      readonly reason: 'host-pty-unavailable' | 'tty-required' | 'docker-exec-signal-unsupported';
    }
  | {
      readonly kind: 'rejected';
      readonly action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal';
      readonly reason: 'execution-completed' | 'stdin-ended' | 'invalid-terminal-size';
    }
  | {
      readonly kind: 'failed';
      readonly action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal';
      readonly error: CapsuleRecordedError;
    };

export type CapsuleInteractiveEvent =
  | {
      readonly kind: 'output';
      readonly stream: 'stdout' | 'stderr' | 'terminal';
      readonly chunk: Uint8Array;
    }
  | {
      readonly kind: 'control-result';
      readonly controlId: string;
      readonly result: CapsuleInteractiveControlResult;
    };

export type CapsuleExecutionCancellation =
  | { readonly kind: 'not-cancellable' }
  | { readonly kind: 'abort-signal'; readonly signal: AbortSignal };

export type CapsuleExecutionInteraction =
  | {
      readonly kind: 'captured';
      readonly cancellation: CapsuleExecutionCancellation;
      readonly controls: AsyncIterable<CapsuleExecutionControl>;
    }
  | {
      readonly kind: 'interactive';
      readonly cancellation: CapsuleExecutionCancellation;
      readonly terminal: CapsuleTerminalSize;
      readonly controls: AsyncIterable<CapsuleExecutionControl>;
      readonly onEvent: (event: CapsuleInteractiveEvent) => Promise<void>;
    };
