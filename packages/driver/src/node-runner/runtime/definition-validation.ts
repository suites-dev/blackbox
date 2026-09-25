import type { DriverDefinition } from '../../model/definition.js';
import { isDriverName } from '../../model/driver-name.js';

export function isDriverDefinition(value: unknown): value is DriverDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === 'project-driver' &&
    typeof record.name === 'string' &&
    isDriverName(record.name) &&
    typeof record.prepare === 'function'
  );
}
