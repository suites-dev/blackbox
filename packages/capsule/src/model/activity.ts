import type {
  ActiveTelemetryExecutionScopeRecord,
  CompletedTelemetryExecutionScopeRecord,
} from '@suites/blackbox-telemetry';

import type { CapsuleActivityName, CapsuleActivityPurpose } from './activity-label.js';
import type { CapsuleRecordedError } from './recorded-error.js';
import type { CapsuleExecutionOutcome } from './outcome.js';

interface CapsuleActivityBase {
  readonly activityId: string;
  readonly sequence: number;
  readonly name: CapsuleActivityName;
  readonly purpose: CapsuleActivityPurpose;
  readonly target:
    { readonly kind: 'host' } | { readonly kind: 'driver'; readonly driverId: string };
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
