import type { Readable } from 'node:stream';

import type { DriverDefinition } from '../../model/definition.js';
import type { DriverPrepareResponse } from '../../model/preparation.js';
import { decodeDriverPrepareRequest } from '../../protocol/decode.js';
import { isDriverDefinition } from './definition-validation.js';
import { prepareDriver } from '../preparation/prepare-driver.js';
import type { RunNodeDriverProcessInput } from './runner-types.js';

type FailedDriverPrepareResponse = Extract<
  DriverPrepareResponse,
  { readonly kind: 'driver-prepare-failed' }
>;

async function readInput(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(
  error: unknown,
  driver: FailedDriverPrepareResponse['driver'],
): DriverPrepareResponse {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    kind: 'driver-prepare-failed',
    protocolVersion: 1,
    driver,
    error: { name: normalized.name, message: normalized.message },
  };
}

async function preparationResponse(
  definition: DriverDefinition,
  stream: Readable,
): Promise<DriverPrepareResponse> {
  // A named driver reports its name; one without a name reports the catalog key it served.
  let driverName = 'name' in definition ? definition.name : null;
  try {
    const request = decodeDriverPrepareRequest(await readInput(stream));
    driverName ??= request.driverId;
    return (await prepareDriver({ definition, request })).response;
  } catch (error) {
    return failure(
      error,
      driverName === null ? { kind: 'unavailable' } : { kind: 'available', name: driverName },
    );
  }
}

export async function runNodeDriverProcess(input: RunNodeDriverProcessInput): Promise<void> {
  const response = isDriverDefinition(input.definition)
    ? await preparationResponse(input.definition, input.input)
    : failure(new Error('Invalid project driver default export'), { kind: 'unavailable' });
  input.output.write(`${JSON.stringify(response)}\n`);
}
