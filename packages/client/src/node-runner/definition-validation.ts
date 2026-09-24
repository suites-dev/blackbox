import type { ClientDefinition } from '../model/client-types.js';
import { isClientName } from '../model/client-name.js';
import type { ClientIdentity } from './runner-types.js';

export function isClientDefinition(value: unknown): value is ClientDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.kind === 'entrypoint' || record.kind === 'utility') &&
    typeof record.name === 'string' &&
    isClientName(record.name) &&
    typeof record.run === 'function'
  );
}

export function clientIdentity(definition: ClientDefinition): ClientIdentity {
  return { kind: definition.kind, name: definition.name };
}
