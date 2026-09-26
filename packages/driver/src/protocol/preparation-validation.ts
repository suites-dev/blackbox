import { createTelemetryPropagationRecord } from '@suites/blackbox-telemetry-internal';

import type { DriverPrepareRequest } from '../model/driver-context.js';
import type { DriverPreparation } from '../model/preparation.js';
import { DriverProtocolError } from './protocol-error.js';

function invalid(message: string): never {
  throw new DriverProtocolError({ operation: 'validate-preparation', message });
}

function validateExecutable(request: DriverPrepareRequest, result: DriverPreparation): void {
  if (result.argv.length === 0) {
    invalid('Prepared command argv must not be empty');
  }
  if (result.argv[0] !== request.command.argv[0]) {
    invalid('Driver must preserve the supplied executable');
  }
}

function validatePropagation(request: DriverPrepareRequest, result: DriverPreparation): void {
  try {
    createTelemetryPropagationRecord({
      expectation: request.propagation,
      outcome: result.propagation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    invalid(message);
  }
}

function validateArgvRedaction(input: {
  readonly redaction: DriverPreparation['redaction']['requestArgv'];
  readonly argv: readonly string[];
  readonly subject: 'request' | 'prepared';
}): void {
  if (input.redaction.kind !== 'positions') {
    return;
  }
  for (const position of input.redaction.positions) {
    if (position >= input.argv.length) {
      invalid(`Redacted argv position ${position} is outside the ${input.subject} command`);
    }
  }
}

function validateRedaction(request: DriverPrepareRequest, result: DriverPreparation): void {
  validateArgvRedaction({
    redaction: result.redaction.requestArgv,
    argv: request.command.argv,
    subject: 'request',
  });
  validateArgvRedaction({
    redaction: result.redaction.preparedArgv,
    argv: result.argv,
    subject: 'prepared',
  });
  if (result.redaction.environment.kind === 'keys') {
    for (const key of result.redaction.environment.keys) {
      if (!Object.hasOwn(result.environment, key)) {
        invalid(`Redacted environment key ${JSON.stringify(key)} is not prepared for execution`);
      }
    }
  }
}

export function validateDriverPreparation(input: {
  readonly request: DriverPrepareRequest;
  readonly preparation: DriverPreparation;
}): DriverPreparation {
  validateExecutable(input.request, input.preparation);
  validatePropagation(input.request, input.preparation);
  validateRedaction(input.request, input.preparation);
  return input.preparation;
}
