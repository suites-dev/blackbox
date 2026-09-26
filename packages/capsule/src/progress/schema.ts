import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { CapsuleProgressEvent } from '../types.js';

export const capsuleProgressSchemaUrl = new URL(
  '../../schema/capsule-progress-v1.json',
  import.meta.url,
);
export const capsuleProgressSchema = JSON.parse(
  readFileSync(capsuleProgressSchemaUrl, 'utf8'),
) as object;
const validate = new Ajv2020({ strict: true, allErrors: true }).compile<CapsuleProgressDocument>(
  capsuleProgressSchema,
);

export interface CapsuleProgressDocument {
  readonly schemaVersion: 1;
  readonly kind: 'capsule-progress';
  readonly events: readonly CapsuleProgressEvent[];
}

export function decodeCapsuleProgress(input: {
  readonly document: unknown;
  readonly sessionId: string;
}): readonly CapsuleProgressEvent[] {
  // Existing sessions used a bare array. Validate them with the same event contract.
  const document: unknown = Array.isArray(input.document)
    ? { schemaVersion: 1, kind: 'capsule-progress', events: input.document }
    : input.document;
  if (!validate(document)) {
    throw new Error('Invalid or unsupported Capsule progress artifact');
  }
  for (const [index, event] of document.events.entries()) {
    if (event.sessionId !== input.sessionId || event.sequence !== index + 1) {
      throw new Error('Capsule progress identity or sequence mismatch');
    }
  }
  return document.events;
}
