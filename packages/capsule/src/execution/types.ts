import type {
  DriverRedaction,
} from '@suites/blackbox-driver';
import type {
  CollectorActivityReadResult,
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector-internal';
import type {
  ActiveTelemetryExecutionScopeRecord,
  CompletedTelemetryExecutionScopeRecord,
  TelemetryPropagationRecord,
} from '@suites/blackbox-telemetry-internal';

import type { CapsuleOperationFailure, CapsuleRecordedError } from '../types.js';

export type CapsuleActivityPurpose = 'setup' | 'stimulus' | 'inspection';

export type CapsuleActivityName =
  | { readonly kind: 'omitted' }
  | { readonly kind: 'provided'; readonly value: string };

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
  | CapsuleInteractiveControl
  | { readonly kind: 'force-terminate'; readonly controlId: string };

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
      readonly reason:
        | 'host-pty-unavailable'
        | 'tty-required'
        | 'docker-exec-signal-unsupported';
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
  readonly onEvent: (event: CapsuleInteractiveEvent) => void;
}

export type CapsuleExecutionInteraction =
  | { readonly kind: 'captured' }
  | {
      readonly kind: 'interactive';
      readonly terminal: CapsuleTerminalSize;
      readonly controls: AsyncIterable<CapsuleExecutionControl>;
      readonly onEvent: (event: CapsuleInteractiveEvent) => void;
    };

export type CapsuleExecutionLocation =
  | { readonly kind: 'host' }
  | {
      readonly kind: 'participant';
      readonly participantId: string;
      readonly service: string;
    };

export type CapsuleOutputRetention =
  | { readonly kind: 'complete'; readonly originalBytes: number }
  | {
      readonly kind: 'truncated';
      readonly originalBytes: number;
      readonly retainedBytes: number;
      readonly omittedBytes: number;
      readonly retained: 'head-and-tail';
    };

interface CapsuleProcessFields {
  readonly argv: readonly string[];
  readonly location: CapsuleExecutionLocation;
  readonly stdout: string;
  readonly stderr: string;
  readonly retention: {
    readonly stdout: CapsuleOutputRetention;
    readonly stderr: CapsuleOutputRetention;
  };
}

export type CapsuleProcessOutcome =
  | (CapsuleProcessFields & { readonly kind: 'exited'; readonly exitCode: number })
  | (CapsuleProcessFields & { readonly kind: 'signaled'; readonly signal: NodeJS.Signals })
  | {
      readonly kind: 'executable-not-found';
      readonly argv: readonly string[];
      readonly location: CapsuleExecutionLocation;
      readonly remediation: string;
    };

export interface CapsuleDriverDetails {
  readonly id: string;
  readonly target: {
    readonly kind: 'participant';
    readonly participantId: string;
    readonly service: string;
    readonly protocol: string;
    readonly containerPort: number;
  };
  readonly execution: CapsuleExecutionLocation;
}

export type CapsuleDriverOutcome =
  | {
      readonly kind: 'driver-completed';
      readonly driver: CapsuleDriverDetails;
      readonly propagation: TelemetryPropagationRecord;
      readonly redaction: DriverRedaction;
      readonly process: CapsuleProcessOutcome;
    }
  | {
      readonly kind: 'driver-prepare-failed';
      readonly driverId: string;
      readonly propagation: TelemetryPropagationRecord;
      readonly error: CapsuleRecordedError;
    }
  | {
      readonly kind: 'driver-propagation-refused';
      readonly driverId: string;
      readonly propagation: TelemetryPropagationRecord;
    };

export type CapsuleRawCommandOutcome = CapsuleProcessOutcome & {
  readonly propagation: TelemetryPropagationRecord;
};

export type CapsuleExecutionOutcome =
  | CapsuleProcessOutcome
  | CapsuleRawCommandOutcome
  | CapsuleDriverOutcome;

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

interface CapsuleActivityBase {
  readonly activityId: string;
  readonly sequence: number;
  readonly name: CapsuleActivityName;
  readonly purpose: CapsuleActivityPurpose;
  readonly target:
    | { readonly kind: 'host' }
    | { readonly kind: 'driver'; readonly driverId: string };
  readonly argv: readonly string[];
  readonly startedAt: string;
}

export type CapsuleActivityReport =
  | (CapsuleActivityBase & {
      readonly kind: 'running';
      readonly telemetry: ActiveTelemetryExecutionScopeRecord;
    })
  | (CapsuleActivityBase & {
      readonly kind: 'completed';
      readonly telemetry: CompletedTelemetryExecutionScopeRecord;
      readonly outcome: CapsuleExecutionOutcome;
      readonly completedAt: string;
    })
  | (CapsuleActivityBase & {
      readonly kind: 'interrupted';
      readonly telemetry: CompletedTelemetryExecutionScopeRecord;
      readonly error: CapsuleRecordedError;
      readonly completedAt: string;
    })
  | (CapsuleActivityBase & {
      readonly kind: 'failed';
      readonly telemetry: CompletedTelemetryExecutionScopeRecord;
      readonly error: CapsuleRecordedError;
      readonly completedAt: string;
    });
