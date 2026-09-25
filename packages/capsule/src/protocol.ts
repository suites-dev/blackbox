import type {
  CapsuleActivityName,
  CapsuleActivityPurpose,
  CapsuleExecutionOutcome,
  CapsuleExecTarget,
  CapsuleInteractiveControlResult,
  CapsuleTerminalSize,
} from './types.js';

export type CapsuleManagerRequest =
  | {
      readonly kind: 'exec-request';
      readonly requestId: string;
      readonly name: CapsuleActivityName;
      readonly purpose: CapsuleActivityPurpose;
      readonly target: CapsuleExecTarget;
    }
  | {
      readonly kind: 'interactive-exec-request';
      readonly requestId: string;
      readonly name: CapsuleActivityName;
      readonly purpose: CapsuleActivityPurpose;
      readonly target: CapsuleExecTarget;
      readonly terminal: CapsuleTerminalSize;
    }
  | {
      readonly kind: 'stop-request';
      readonly requestId: string;
      readonly reason: 'completed' | 'cancelled' | 'failed' | 'interrupted';
    };

export type CapsuleManagerControlFrame =
  | {
      readonly kind: 'exec-stdin-chunk';
      readonly requestId: string;
      readonly controlId: string;
      readonly chunk: string;
    }
  | {
      readonly kind: 'exec-stdin-end';
      readonly requestId: string;
      readonly controlId: string;
    }
  | {
      readonly kind: 'exec-resize';
      readonly requestId: string;
      readonly controlId: string;
      readonly terminal: CapsuleTerminalSize;
    }
  | {
      readonly kind: 'exec-signal';
      readonly requestId: string;
      readonly controlId: string;
      readonly signal: 'SIGINT' | 'SIGQUIT';
    };

export type CapsuleManagerClientFrame = CapsuleManagerRequest | CapsuleManagerControlFrame;

export type CapsuleManagerResponse =
  | {
      readonly kind: 'exec-response';
      readonly requestId: string;
      readonly activityId: string;
      readonly outcome: CapsuleExecutionOutcome;
    }
  | {
      readonly kind: 'stop-response';
      readonly requestId: string;
      readonly cleanup: 'complete';
    }
  | {
      readonly kind: 'manager-error-response';
      readonly requestId: string;
      readonly error: { readonly name: string; readonly message: string };
    };

export type CapsuleManagerEvent =
  | {
      readonly kind: 'exec-output';
      readonly requestId: string;
      readonly stream: 'stdout' | 'stderr' | 'terminal';
      readonly chunk: string;
    }
  | {
      readonly kind: 'exec-control-result';
      readonly requestId: string;
      readonly controlId: string;
      readonly result: CapsuleInteractiveControlResult;
    };

export type CapsuleManagerServerFrame = CapsuleManagerResponse | CapsuleManagerEvent;

export interface CapsuleManagerBootstrap {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly systemId: string;
  readonly environment: Readonly<Record<string, string>>;
}
