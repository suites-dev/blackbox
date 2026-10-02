import type { CollectorEndpoint } from './endpoint.js';
import type { CollectorFailure } from './failure.js';
import type { CollectorIdentity } from './identity.js';
import type {
  CollectorInstrumentationStatus,
  CollectorTelemetryStatus,
  ReceiverStatus,
  ShutdownStatus,
} from './lifecycle.js';

export interface CollectorStatus extends CollectorIdentity {
  readonly kind: 'collector-status';
  readonly instanceId: string;
  readonly receiver: ReceiverStatus;
  readonly instrumentation: CollectorInstrumentationStatus;
  readonly telemetry: CollectorTelemetryStatus;
  readonly shutdown: ShutdownStatus;
  readonly failure: CollectorFailure | null;
}

export type CollectorCloseResult =
  | {
      readonly kind: 'collector-stopped';
      readonly status: CollectorStatus;
      readonly alreadyStopped: boolean;
    }
  | {
      readonly kind: 'collector-stop-failed';
      readonly status: CollectorStatus;
      readonly error: CollectorFailure;
    };

export interface CollectorHandle extends CollectorIdentity {
  readonly kind: 'collector';
  readonly endpoint: CollectorEndpoint;
  readonly status: () => CollectorStatus;
  readonly close: () => Promise<CollectorCloseResult>;
}
