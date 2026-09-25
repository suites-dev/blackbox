import type { DriverPrepareResponse } from '../../model/preparation.js';
import { validateDriverPreparation } from '../../protocol/preparation-validation.js';
import { withDriverPreparationTimeout } from '../../protocol/timeout.js';
import { cloneAndFreeze } from '../runtime/freeze-request.js';
import type { PrepareDriverInput, PreparedDriver } from '../runtime/runner-types.js';

export async function prepareDriver(input: PrepareDriverInput): Promise<PreparedDriver> {
  if (input.definition.name !== input.request.driverId) {
    throw new Error(
      `Driver definition name ${input.definition.name} does not match ${input.request.driverId}`,
    );
  }
  const request = cloneAndFreeze(input.request);
  const candidate = await withDriverPreparationTimeout(
    Promise.resolve(input.definition.prepare(request)),
  );
  const preparation = validateDriverPreparation({ request: input.request, preparation: candidate });
  const response = {
    kind: 'driver-prepare-succeeded',
    protocolVersion: 1,
    driver: { kind: 'available', name: input.definition.name },
    preparation,
  } satisfies DriverPrepareResponse;
  return { response, preparation };
}
