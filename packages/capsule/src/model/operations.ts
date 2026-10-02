import type { RuntimeActivationAdapter } from '@suites/blackbox-instrumentation';
import type {
  CollectorActivityReadResult,
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector';

import type { CapsuleProgressMode } from '../progress/events.js';
import type { CapsuleActivityName, CapsuleActivityPurpose } from './activity-label.js';
import type {
  CapsuleContainerDetails,
  CapsuleEntrypoint,
  CapsuleReadinessDetails,
} from './environment.js';
import type { CapsuleOperationFailure } from './failure.js';
import type {
  CapsuleInteractiveControl,
  CapsuleInteractiveEvent,
  CapsuleTerminalSize,
} from './interaction.js';
import type { CapsuleDescription } from './lifecycle.js';
import type { CapsuleExecutionOutcome } from './outcome.js';

export interface CapsuleStartInput {
  readonly projectDirectory: string;
  readonly systemId: string;
  readonly title: string;
  readonly description: CapsuleDescription;
  readonly environment: Readonly<Record<string, string>>;
  readonly runtimeActivationAdapters: readonly RuntimeActivationAdapter[];
  readonly progress: CapsuleProgressMode;
}

export type CapsuleStartResult =
  | {
      readonly kind: 'capsule-started';
      readonly sessionId: string;
      readonly system: string;
      readonly title: string;
      readonly composeProject: string;
      readonly artifactRoot: string;
      readonly entrypoint: CapsuleEntrypoint;
      readonly containers: readonly CapsuleContainerDetails[];
      readonly networks: readonly string[];
      readonly volumes: readonly string[];
      readonly readiness: CapsuleReadinessDetails;
    }
  | CapsuleOperationFailure;

export interface CapsuleStopInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly reason: 'completed' | 'cancelled' | 'failed' | 'interrupted';
}

export type CapsuleStopResult =
  | {
      readonly kind: 'capsule-stopped';
      readonly sessionId: string;
      readonly cleanup: 'complete';
      readonly alreadyStopped: boolean;
    }
  | CapsuleOperationFailure;

export interface CapsuleReportInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
}

export type CapsuleExecTarget =
  | { readonly kind: 'host'; readonly argv: readonly [string, ...string[]] }
  | {
      readonly kind: 'driver';
      readonly driverId: string;
      readonly argv: readonly [string, ...string[]];
      readonly untraced: { readonly kind: 'refuse' } | { readonly kind: 'allow' };
    };

export interface CapsuleExecInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly name: CapsuleActivityName;
  readonly purpose: CapsuleActivityPurpose;
  readonly target: CapsuleExecTarget;
}

export interface CapsuleInteractiveExecInput extends CapsuleExecInput {
  readonly terminal: CapsuleTerminalSize;
  readonly controls: AsyncIterable<CapsuleInteractiveControl>;
  readonly onEvent: (event: CapsuleInteractiveEvent) => Promise<void>;
}

export type CapsuleExecResult =
  | {
      readonly kind: 'capsule-exec-completed';
      readonly activityId: string;
      readonly outcome: CapsuleExecutionOutcome;
    }
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
