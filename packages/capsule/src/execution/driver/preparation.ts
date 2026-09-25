import { resolve } from 'node:path';

import {
  prepareNodeProjectDriver,
  type DriverPreparation,
  type DriverPrepareRequest,
} from '@suites/blackbox-driver';
import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import {
  createTelemetryPropagationRecord,
  type TelemetryPropagationRecord,
} from '@suites/blackbox-telemetry-internal';

import type { CapsuleDriverOutcome, CapsuleRecordedError } from '../../types.js';
import { failedPropagation } from './propagation.js';
import { redactEnvironmentError } from './secrets.js';
import { redactValues } from '../output/value-redaction.js';

type PreparationFailure = Exclude<CapsuleDriverOutcome, { readonly kind: 'driver-completed' }>;

export type CapsuleDriverPreparation =
  | {
      readonly kind: 'driver-prepared';
      readonly command: DriverPreparation;
      readonly propagation: TelemetryPropagationRecord;
    }
  | PreparationFailure;

function failed(driver: ResolvedCatalogDriver, error: CapsuleRecordedError): PreparationFailure {
  return {
    kind: 'driver-prepare-failed',
    driverId: driver.id,
    propagation: failedPropagation(driver.propagation, error.message),
    error,
  };
}

export async function prepareCapsuleDriver(input: {
  readonly projectDirectory: string;
  readonly driver: ResolvedCatalogDriver;
  readonly request: DriverPrepareRequest;
  readonly untraced: { readonly kind: 'refuse' } | { readonly kind: 'allow' };
}): Promise<CapsuleDriverPreparation> {
  let response;
  try {
    response = await prepareNodeProjectDriver({
      driverModulePath: resolve(input.projectDirectory, input.driver.ref),
      projectDirectory: input.projectDirectory,
      request: input.request,
    });
  } catch (error) {
    return failed(
      input.driver,
      redactEnvironmentError({ error, environment: input.request.target.environment }),
    );
  }
  if (response.kind === 'driver-prepare-failed') {
    return failed(
      input.driver,
      redactEnvironmentError({
        error: Object.assign(new Error(response.error.message), { name: response.error.name }),
        environment: input.request.target.environment,
      }),
    );
  }
  const command = response.preparation;
  const outcome = command.propagation.kind === 'context-injection-failed'
    ? { ...command.propagation, message: redactValues(command.propagation.message,
        [...Object.values(input.request.target.environment), ...Object.values(command.environment)]) }
    : command.propagation;
  const propagation = createTelemetryPropagationRecord({
    expectation: input.driver.propagation,
    outcome,
  });
  if (command.propagation.kind === 'context-injection-failed' &&
      input.untraced.kind === 'refuse') {
    return { kind: 'driver-propagation-refused', driverId: input.driver.id, propagation };
  }
  return { kind: 'driver-prepared', command, propagation };
}
