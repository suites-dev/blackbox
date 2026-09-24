import type { CapsuleExecutionOutcome, CapsuleExecTarget } from './types.js';

export type CapsuleManagerRequest =
  | {
      readonly kind: 'exec-request';
      readonly requestId: string;
      readonly target: CapsuleExecTarget;
    }
  | {
      readonly kind: 'stop-request';
      readonly requestId: string;
      readonly reason: 'completed' | 'cancelled' | 'failed' | 'interrupted';
    };

export type CapsuleManagerResponse =
  | {
      readonly kind: 'exec-response';
      readonly requestId: string;
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

export interface CapsuleManagerBootstrap {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly systemId: string;
  readonly environment: Readonly<Record<string, string>>;
}
