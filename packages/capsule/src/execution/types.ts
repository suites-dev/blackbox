import type { ClientResult } from '@suites/blackbox-client';
import type {
  CollectorActivityReadResult,
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector-internal';

import type { CapsuleOperationFailure, CapsuleRecordedError } from '../types.js';

export type CapsuleExecTarget =
  | { readonly kind: 'host'; readonly argv: readonly [string, ...string[]] }
  | {
      readonly kind: 'participant';
      readonly participant: string;
      readonly argv: readonly [string, ...string[]];
    }
  | {
      readonly kind: 'client';
      readonly clientId: string;
      readonly args: readonly string[];
    };

export interface CapsuleExecInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly target: CapsuleExecTarget;
}

export type CapsuleProcessOutcome =
  | {
      readonly kind: 'exited';
      readonly argv: readonly string[];
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: 'signaled';
      readonly argv: readonly string[];
      readonly signal: NodeJS.Signals;
      readonly stdout: string;
      readonly stderr: string;
    };

export interface CapsuleClientOutcome {
  readonly kind: 'client-completed';
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly behavior: 'entrypoint' | 'utility';
  };
  readonly result: ClientResult;
  readonly telemetry:
    | { readonly kind: 'not-requested' }
    | { readonly kind: 'complete' }
    | { readonly kind: 'incomplete'; readonly error: CapsuleRecordedError };
}

export type CapsuleExecutionOutcome = CapsuleProcessOutcome | CapsuleClientOutcome;

export type CapsuleExecResult =
  | { readonly kind: 'capsule-exec-completed'; readonly outcome: CapsuleExecutionOutcome }
  | CapsuleOperationFailure;

export interface CapsuleObservationsInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly selection:
    | { readonly kind: 'session' }
    | { readonly kind: 'activity'; readonly activityId: string }
    | { readonly kind: 'trace'; readonly traceId: string };
}

export type CapsuleObservationsResult =
  | CollectorSessionReadResult
  | CollectorActivityReadResult
  | CollectorTraceReadResult
  | CapsuleOperationFailure;

interface CapsuleActivityBase {
  readonly activityId: string;
  readonly sequence: number;
  readonly target:
    | { readonly kind: 'host' }
    | { readonly kind: 'participant'; readonly participant: string }
    | { readonly kind: 'client'; readonly clientId: string };
  readonly argv: readonly string[];
  readonly startedAt: string;
}

export type CapsuleActivityReport =
  | (CapsuleActivityBase & { readonly kind: 'running' })
  | (CapsuleActivityBase & {
      readonly kind: 'completed';
      readonly outcome: CapsuleExecutionOutcome;
      readonly completedAt: string;
    })
  | (CapsuleActivityBase & {
      readonly kind: 'failed';
      readonly error: CapsuleRecordedError;
      readonly completedAt: string;
    });
