import { clientIdentity, isClientDefinition } from './definition-validation.js';
import type {
  ClientInspectionResult,
  InspectNodeClientDefinitionInput,
} from './runner-types.js';

function inspectDefinition(definition: unknown): ClientInspectionResult {
  if (!isClientDefinition(definition)) {
    return {
      kind: 'unavailable',
      error: {
        name: 'InvalidClientDefinitionError',
        message: 'Client module default export is not a valid client definition',
      },
    };
  }
  return { kind: 'available', client: clientIdentity(definition) };
}

export function inspectNodeClientDefinition(
  input: InspectNodeClientDefinitionInput,
): ClientInspectionResult {
  const result = inspectDefinition(input.definition);
  input.output.write(`${JSON.stringify(result)}\n`);
  return result;
}
