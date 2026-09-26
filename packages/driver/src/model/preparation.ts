import type { PropagationOutcome } from '@suites/blackbox-telemetry-internal';

export type DriverArgvRedaction =
  | { readonly kind: 'none' }
  | { readonly kind: 'positions'; readonly positions: readonly number[] };

export type DriverEnvironmentRedaction =
  | { readonly kind: 'none' }
  | { readonly kind: 'keys'; readonly keys: readonly string[] };

export interface DriverRedaction {
  readonly kind: 'driver-redaction';
  readonly requestArgv: DriverArgvRedaction;
  readonly preparedArgv: DriverArgvRedaction;
  readonly environment: DriverEnvironmentRedaction;
}

export interface DriverPreparation {
  readonly kind: 'prepared-command';
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly propagation: PropagationOutcome;
  readonly redaction: DriverRedaction;
}

export type DriverPrepareResponse =
  | {
      readonly kind: 'driver-prepare-succeeded';
      readonly protocolVersion: 1;
      readonly driver: { readonly kind: 'available'; readonly name: string };
      readonly preparation: DriverPreparation;
    }
  | {
      readonly kind: 'driver-prepare-failed';
      readonly protocolVersion: 1;
      readonly driver:
        | { readonly kind: 'available'; readonly name: string }
        | { readonly kind: 'unavailable' };
      readonly error: { readonly name: string; readonly message: string };
    };
