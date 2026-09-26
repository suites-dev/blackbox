export type W3CPropagationCarrier =
  | 'http-headers'
  | 'message-metadata'
  | 'process-environment';

export type PropagationExpectation =
  | { readonly kind: 'propagation-not-requested' }
  | {
      readonly kind: 'w3c-trace-context-propagation';
      readonly carrier: W3CPropagationCarrier;
    }
  | {
      readonly kind: 'shared-state-propagation-unsupported';
      readonly resource: string;
    };

export type PropagationOutcome =
  | {
      readonly kind: 'context-not-injected';
      readonly reason: 'raw-command' | 'driver-declared-none';
    }
  | {
      readonly kind: 'context-injected';
      readonly format: 'w3c-trace-context';
      readonly carrier: W3CPropagationCarrier;
    }
  | {
      readonly kind: 'context-not-supported';
      readonly boundary: 'shared-state';
      readonly resource: string;
    }
  | {
      readonly kind: 'context-injection-failed';
      readonly format: 'w3c-trace-context';
      readonly carrier: W3CPropagationCarrier;
      readonly message: string;
    };

export interface TelemetryPropagationRecord {
  readonly schemaVersion: 1;
  readonly kind: 'telemetry-propagation-v1';
  readonly expectation: PropagationExpectation;
  readonly outcome: PropagationOutcome;
}
