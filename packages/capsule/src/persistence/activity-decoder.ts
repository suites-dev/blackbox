import { Ajv2020 } from 'ajv/dist/2020.js';

import type { CapsuleActivityReport } from '../types.js';
import { capsuleActivitiesSchema } from '../schema/artifact-schemas.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateActivities = ajv.compile(capsuleActivitiesSchema);

export function decodeCapsuleActivities(input: {
  readonly bytes: string;
}): readonly CapsuleActivityReport[] {
  const value: unknown = JSON.parse(input.bytes);
  if (!validateActivities(value)) {
    throw new Error(
      `Invalid Capsule activities artifact: ${ajv.errorsText(validateActivities.errors, {
        dataVar: 'activities',
        separator: '; ',
      })}`,
    );
  }
  return value as readonly CapsuleActivityReport[];
}
