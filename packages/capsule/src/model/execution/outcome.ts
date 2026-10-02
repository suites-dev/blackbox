import type { DriverRedaction } from '@suites/blackbox-driver';
import type { TelemetryPropagationRecord } from '@suites/blackbox-telemetry';

import type { CapsuleRecordedError } from '../recorded-error.js';
import type { CapsuleExecutionLocation, CapsuleProcessOutcome } from './process-outcome.js';

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
