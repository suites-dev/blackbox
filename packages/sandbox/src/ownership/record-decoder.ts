import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import { sandboxRecordSchema } from '../schema/sandbox-record-schema.js';
import type { SandboxRecord } from './records.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate: ValidateFunction<SandboxRecord> = ajv.compile<SandboxRecord>(sandboxRecordSchema);

export class SandboxRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxRecordValidationError';
  }
}

export function decodeSandboxRecord(input: string): SandboxRecord {
  const value = JSON.parse(input) as unknown;
  if (!validate(value)) {
    throw new SandboxRecordValidationError(
      `Invalid durable sandbox record: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
    );
  }
  return value;
}
