import type { ClientDefinition } from '../model/client-types.js';

export class InvalidClientDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidClientDefinitionError';
  }
}

export function defineClient(definition: ClientDefinition): Readonly<ClientDefinition> {
  if (definition.name.trim() === '') {
    throw new InvalidClientDefinitionError('Client name must not be blank');
  }
  return Object.freeze(definition);
}
