export interface SelectedSystem {
  readonly kind: 'system' | 'subsystem';
  readonly id: string;
}

export function declarationError(message: string): Error {
  return new Error(`Invalid Blackbox Playwright declaration: ${message}`);
}

export function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw declarationError(`${label} must be a non-empty string`);
  }
  return value;
}

export function selectionValue(selection: unknown): Readonly<SelectedSystem> {
  if (typeof selection === 'string') {
    return Object.freeze({ kind: 'system', id: nonemptyString(selection, 'system id') });
  }
  if (selection === null || typeof selection !== 'object') {
    throw declarationError('system selection must identify a system or subsystem');
  }
  if (!('kind' in selection) || !('id' in selection)) {
    throw declarationError('system selection must identify a system or subsystem');
  }
  if (selection.kind !== 'system' && selection.kind !== 'subsystem') {
    throw declarationError('system selection must identify a system or subsystem');
  }
  return Object.freeze({
    kind: selection.kind,
    id: nonemptyString(selection.id, 'selection id'),
  });
}

export function environmentValue(options: unknown): Readonly<Record<string, string>> {
  if (
    options === undefined ||
    (options !== null &&
      typeof options === 'object' &&
      !('environment' in options) &&
      'clients' in options)
  ) {
    return Object.freeze({});
  }
  if (options === null || typeof options !== 'object' || !('environment' in options)) {
    throw declarationError('sandbox options must contain an environment object');
  }
  const environment = options.environment;
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) {
    throw declarationError('sandbox environment must be an object of string values');
  }
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string') {
      throw declarationError(`sandbox environment value ${JSON.stringify(key)} must be a string`);
    }
    copy[key] = value;
  }
  return Object.freeze(copy);
}

export function ensureSynchronous(result: unknown, label: string): void {
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    'then' in result &&
    typeof result.then === 'function'
  ) {
    throw declarationError(`${label} callback must be synchronous`);
  }
}
