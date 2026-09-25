import type { PropagationExpectation } from '@suites/blackbox-telemetry-internal';

import type { DriverTelemetryContext } from './propagation.js';

export interface DriverCommand {
  readonly kind: 'command';
  readonly argv: readonly string[];
}

export type DriverExecution =
  | { readonly kind: 'host' }
  | {
      readonly kind: 'participant';
      readonly participantId: string;
      readonly service: string;
    };

export type DriverEndpoint =
  | {
      readonly kind: 'host';
      readonly host: string;
      readonly port: number;
      readonly url: string;
    }
  | {
      readonly kind: 'participant';
      readonly host: string;
      readonly port: number;
      readonly url: string;
    };

export interface DriverTarget {
  readonly kind: 'participant';
  readonly participantId: string;
  readonly service: string;
  readonly protocol: string;
  readonly containerPort: number;
  readonly environment: Readonly<Record<string, string>>;
  readonly endpoint: DriverEndpoint;
}

export interface DriverPrepareRequest {
  readonly kind: 'driver-prepare-request';
  readonly protocolVersion: 1;
  readonly driverId: string;
  readonly command: DriverCommand;
  readonly target: DriverTarget;
  readonly execution: DriverExecution;
  readonly propagation: PropagationExpectation;
  readonly telemetry: DriverTelemetryContext;
}
