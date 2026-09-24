import { access, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { readCapsuleRecord, recordedError, type CapsuleSessionRecord } from '../records.js';
import type { CapsuleOperationFailure } from '../types.js';

const SESSION_PATTERN =
  /^(?:[a-z]+-[a-z]+-[a-z]+(?:-[0-9]+)?|capsule-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

export function capsuleFailure(input: {
  readonly operation: 'start' | 'exec' | 'stop' | 'report' | 'observations';
  readonly sessionId: string;
  readonly error: unknown;
}): CapsuleOperationFailure {
  return {
    kind: 'capsule-operation-failed',
    operation: input.operation,
    sessionId: input.sessionId,
    error: recordedError(input.error),
  };
}

export function validateSessionId(sessionId: string): void {
  if (!SESSION_PATTERN.test(sessionId)) {
    throw new Error('sessionId must be an exact Capsule-generated identity');
  }
}

export async function canonicalProjectDirectory(projectDirectory: string): Promise<string> {
  if (!isAbsolute(projectDirectory)) {
    throw new Error('projectDirectory must be absolute');
  }
  const canonical = await realpath(projectDirectory);
  await access(join(canonical, 'blackbox.config.yaml'));
  return canonical;
}

export async function readRecordOrNotFound(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): Promise<CapsuleSessionRecord | CapsuleOperationFailure> {
  try {
    return await readCapsuleRecord(input);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        kind: 'capsule-not-found',
        sessionId: input.sessionId,
        message: `Capsule session ${input.sessionId} does not exist`,
      };
    }
    throw error;
  }
}

export function isFailure(
  value: CapsuleSessionRecord | CapsuleOperationFailure,
): value is CapsuleOperationFailure {
  return 'kind' in value;
}
