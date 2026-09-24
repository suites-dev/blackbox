import type { ClientDefinition } from '../model/client-types.js';
import { isClientName } from '../model/client-name.js';

export class InvalidClientDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidClientDefinitionError';
  }
}

export function defineClient(definition: ClientDefinition): Readonly<ClientDefinition> {
  if (!isClientName(definition.name)) {
    throw new InvalidClientDefinitionError(
      'Client name must be a lowercase slug such as postgres-client',
    );
  }
  return Object.freeze(definition);
}
