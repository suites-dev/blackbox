import type { DriverEnvironmentRedaction } from '@suites/blackbox-driver';

import type { CapsuleProcessOutcome, CapsuleRecordedError } from '../../types.js';
import { redactValues } from '../output/value-redaction.js';

type EnvironmentSelection =
  | { readonly kind: 'all' }
  | { readonly kind: 'keys'; readonly keys: readonly string[] };

export function selectedValues(input: {
  readonly environment: Readonly<Record<string, string>>;
  readonly selection: EnvironmentSelection;
}): readonly string[] {
  const keys = input.selection.kind === 'all'
    ? Object.keys(input.environment)
    : input.selection.keys;
  return [...new Set(keys.filter((key) => Object.hasOwn(input.environment, key))
    .map((key) => input.environment[key]).filter((value) => value !== ''))]
    .sort((left, right) => right.length - left.length);
}

export function redactEnvironmentError(input: {
  readonly error: unknown;
  readonly environment: Readonly<Record<string, string>>;
}): CapsuleRecordedError {
  return redactErrorValues({ error: input.error, values: Object.values(input.environment) });
}

function redactErrorValues(input: {
  readonly error: unknown;
  readonly values: readonly string[];
}): CapsuleRecordedError {
  const error = input.error instanceof Error
    ? input.error
    : new Error(String(input.error));
  return { name: redactValues(error.name, input.values), message: redactValues(error.message, input.values) };
}

export function createRedactedError(input: {
  readonly error: unknown;
  readonly values: readonly string[];
}): Error {
  const recorded = redactErrorValues(input);
  return Object.assign(new Error(recorded.message), { name: recorded.name });
}

export function redactProcessMetadata(input: {
  readonly process: CapsuleProcessOutcome;
  readonly environment: Readonly<Record<string, string>>;
  readonly redaction: DriverEnvironmentRedaction;
}): CapsuleProcessOutcome {
  if (input.redaction.kind === 'none') {
    return input.process;
  }
  const values = selectedValues({
    environment: input.environment,
    selection: { kind: 'keys', keys: input.redaction.keys },
  });
  const argv = input.process.argv.map((value) => redactValues(value, values));
  if (input.process.kind === 'executable-not-found') {
    return {
      ...input.process,
      argv,
      remediation: redactValues(input.process.remediation, values),
    };
  }
  return {
    ...input.process,
    argv,
  };
}
