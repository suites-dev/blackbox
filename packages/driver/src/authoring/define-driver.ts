import { isDriverName } from '../model/driver-name.js';
import type { DriverDefinition } from '../model/definition.js';

export class InvalidDriverDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDriverDefinitionError';
  }
}

export function defineDriver(definition: DriverDefinition): Readonly<DriverDefinition> {
  if (!isDriverName(definition.name)) {
    throw new InvalidDriverDefinitionError(
      'Driver name must be a lowercase slug such as postgres-driver',
    );
  }
  return Object.freeze(definition);
}
