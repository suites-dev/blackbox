import type { CollectorEndpoint } from './endpoint.js';
import type { CollectorFailure } from './failure.js';
import type { CollectorIdentity } from './identity.js';

export type ReceiverStatus = 'ready' | 'draining' | 'stopped' | 'failed' | 'interrupted';

export type ShutdownStatus = 'not-started' | 'draining' | 'complete' | 'timed-out' | 'interrupted';

export interface CollectorActivationRecord {
  readonly kind: 'instrumentation-activation';
  readonly runtime: string;
  readonly serviceName: string;
  readonly activatedAt: string;
}

export type CollectorInstrumentationStatus =
  | { readonly kind: 'not-activated' }
  | {
      readonly kind: 'activated';
      readonly activations: readonly CollectorActivationRecord[];
    };

export interface CollectorRunRecord {
  readonly instanceId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stoppedAt: string | null;
  readonly receiver: ReceiverStatus;
  readonly instrumentation: CollectorInstrumentationStatus;
  readonly shutdown: ShutdownStatus;
  readonly failure: CollectorFailure | null;
  readonly endpoint: CollectorEndpoint;
}

export type CollectorTelemetryStatus =
  | {
      readonly status: 'not-received';
      readonly acceptedRequests: 0;
      readonly acceptedSpans: 0;
      readonly lastReceivedAt: null;
    }
  | {
      readonly status: 'received';
      readonly acceptedRequests: number;
      readonly acceptedSpans: number;
      readonly lastReceivedAt: string;
    };

export interface CollectorLifecycleRecord extends CollectorIdentity {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly runs: readonly CollectorRunRecord[];
  readonly telemetry: CollectorTelemetryStatus;
}

export interface ActivateCollectorInput extends CollectorIdentity {
  readonly schemaVersion: 1;
  readonly kind: 'instrumentation-activation-v1';
  readonly runtime: string;
  readonly serviceName: string;
}
