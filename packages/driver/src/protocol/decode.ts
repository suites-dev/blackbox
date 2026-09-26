import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import type { DriverPrepareRequest } from '../model/driver-context.js';
import type { DriverPrepareResponse } from '../model/preparation.js';
import {
  driverPrepareRequestSchema,
  driverPrepareResponseSchema,
} from '../schema/driver-schemas.js';
import { DriverProtocolError } from './protocol-error.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRequest: ValidateFunction<DriverPrepareRequest> =
  ajv.compile<DriverPrepareRequest>(driverPrepareRequestSchema);
const validateResponse: ValidateFunction<DriverPrepareResponse> =
  ajv.compile<DriverPrepareResponse>(driverPrepareResponseSchema);

function decodeJson(input: string, operation: DriverProtocolError['operation']): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    // JSON.parse diagnostics may quote incomplete secret values from the protocol input.
    throw new DriverProtocolError({ operation, message: 'Invalid JSON in driver protocol input' });
  }
}

function validationMessage(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { separator: '; ' });
}

export function decodeDriverPrepareRequest(input: string): DriverPrepareRequest {
  const value = decodeJson(input, 'decode-request');
  if (!validateRequest(value)) {
    throw new DriverProtocolError({
      operation: 'decode-request',
      message: `Invalid driver prepare request: ${validationMessage(validateRequest)}`,
    });
  }
  return value;
}

export function decodeDriverPrepareResponse(input: string): DriverPrepareResponse {
  const value = decodeJson(input, 'decode-response');
  if (!validateResponse(value)) {
    throw new DriverProtocolError({
      operation: 'decode-response',
      message: `Invalid driver prepare response: ${validationMessage(validateResponse)}`,
    });
  }
  return value;
}
