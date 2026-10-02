import type { DriverRedaction } from '@suites/blackbox-driver';
import type { TelemetryPropagationRecord } from '@suites/blackbox-telemetry';

import type { CapsuleRecordedError } from './recorded-error.js';

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
    }
  | {
      /** The host refused to execute the file (EACCES or EPERM); no process ran. */
      readonly kind: 'not-executable';
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
  CapsuleProcessOutcome | CapsuleRawCommandOutcome | CapsuleDriverOutcome;
