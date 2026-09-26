import type { ActivateCollectorInput } from '../model/types.js';
import {
  recordedFailure,
  validateIdentity,
  validateNonBlankField,
} from '../model/validation.js';
import { RequestFailure } from '../transport/response.js';

export function parseActivation(value: unknown): ActivateCollectorInput {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('kind' in value) ||
    value.kind !== 'instrumentation-activation-v1' ||
    !('sessionId' in value) ||
    !('executionId' in value) ||
    !('runtime' in value) ||
    !('serviceName' in value)
  ) {
    throw new RequestFailure(400, 'Instrumentation activation has an unsupported shape.');
  }
  try {
    const parsed = {
      schemaVersion: 1,
      kind: 'instrumentation-activation-v1',
      sessionId: validateNonBlankField({ field: 'sessionId', value: value.sessionId }),
      executionId: validateNonBlankField({ field: 'executionId', value: value.executionId }),
      runtime: validateNonBlankField({ field: 'runtime', value: value.runtime }),
      serviceName: validateNonBlankField({ field: 'serviceName', value: value.serviceName }),
    } satisfies ActivateCollectorInput;
    validateIdentity(parsed);
    return parsed;
  } catch (error) {
    throw new RequestFailure(400, recordedFailure(error).message);
  }
}
