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
import { canonicalDriverModule } from './module-path.js';
import { failedPropagation } from './propagation.js';
import { redactPreparationError, selectedArgvValues } from './secrets.js';
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
    const driverModulePath = await canonicalDriverModule({
      projectDirectory: input.projectDirectory,
      reference: input.driver.ref,
    });
    response = await prepareNodeProjectDriver({
      driverModulePath,
      projectDirectory: input.projectDirectory,
      request: input.request,
    });
  } catch (error) {
    return failed(
      input.driver,
      redactPreparationError({
        error,
        environment: input.request.target.environment,
        requestArgv: input.request.command.argv,
      }),
    );
  }
  if (response.kind === 'driver-prepare-failed') {
    return failed(
      input.driver,
      redactPreparationError({
        error: Object.assign(new Error(response.error.message), { name: response.error.name }),
        environment: input.request.target.environment,
        requestArgv: input.request.command.argv,
      }),
    );
  }
  const command = response.preparation;
  const requestArgvValues = selectedArgvValues({
    argv: input.request.command.argv,
    selection: command.redaction.requestArgv,
  });
  const preparedArgvValues = selectedArgvValues({
    argv: command.argv,
    selection: command.redaction.preparedArgv,
  });
  const outcome = command.propagation.kind === 'context-injection-failed'
    ? { ...command.propagation, message: redactValues(command.propagation.message,
        [
          ...Object.values(input.request.target.environment),
          ...Object.values(command.environment),
          ...requestArgvValues,
          ...preparedArgvValues,
        ]) }
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
