import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import { driverRuntimeSchema } from '../schema/driver-schemas.js';

export interface NodeDriverRuntimeArtifact {
  readonly schemaVersion: 1;
  readonly kind: 'blackbox-driver-runtime';
  readonly runtime: 'node';
}

export type DriverRuntimeArtifact = NodeDriverRuntimeArtifact;

export const nodeDriverRuntimeArtifact = {
  schemaVersion: 1,
  kind: 'blackbox-driver-runtime',
  runtime: 'node',
} satisfies NodeDriverRuntimeArtifact;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate: ValidateFunction<DriverRuntimeArtifact> =
  ajv.compile<DriverRuntimeArtifact>(driverRuntimeSchema);

export class DriverRuntimeArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverRuntimeArtifactError';
  }
}

export function validateDriverRuntimeArtifact(value: unknown): DriverRuntimeArtifact {
  if (!validate(value)) {
    throw new DriverRuntimeArtifactError(
      `Invalid driver runtime artifact: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
    );
  }
  return value;
}

export function decodeDriverRuntimeArtifact(input: string): DriverRuntimeArtifact {
  try {
    return validateDriverRuntimeArtifact(JSON.parse(input) as unknown);
  } catch (error) {
    if (error instanceof DriverRuntimeArtifactError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new DriverRuntimeArtifactError(`Invalid driver runtime artifact JSON: ${message}`);
  }
}
