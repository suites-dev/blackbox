import type { Readable } from 'node:stream';

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

export async function runNodeDriverProcess(input: RunNodeDriverProcessInput): Promise<void> {
  let response: DriverPrepareResponse;
  if (!isDriverDefinition(input.definition)) {
    response = failure(new Error('Invalid project driver default export'), {
      kind: 'unavailable',
    });
  } else {
    try {
      const request = decodeDriverPrepareRequest(await readInput(input.input));
      response = (await prepareDriver({ definition: input.definition, request })).response;
    } catch (error) {
      response = failure(error, { kind: 'available', name: input.definition.name });
    }
  }
  input.output.write(`${JSON.stringify(response)}\n`);
}
