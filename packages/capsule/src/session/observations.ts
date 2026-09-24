import {
  readCollectorActivity,
  readCollectorSession,
  readCollectorTrace,
  type CollectorSessionReadResult,
} from '@suites/blackbox-otel-collector-internal';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox-internal';

import { capsuleSandboxRecordDirectory } from '../records.js';
import type {
  CapsuleObservationsInput,
  CapsuleObservationsResult,
  CapsuleOperationFailure,
} from '../types.js';
import {
  canonicalProjectDirectory,
  capsuleFailure,
  isFailure,
  readRecordOrNotFound,
  validateSessionId,
} from './validation.js';

export async function readCapsuleObservations(
  input: CapsuleObservationsInput,
): Promise<CapsuleObservationsResult> {
  try {
    validateSessionId(input.sessionId);
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    const record = await readRecordOrNotFound({ projectDirectory, sessionId: input.sessionId });
    if (isFailure(record)) {
      return record;
    }
    const identity = {
      sessionId: record.sessionId,
      executionId: record.executionId,
      storageDirectory: sandboxTelemetryStorageDirectory({
        recordDirectory: capsuleSandboxRecordDirectory({
          projectDirectory,
          sessionId: record.sessionId,
        }),
        sandboxId: record.executionId,
      }),
    };
    switch (input.selection.kind) {
      case 'session':
        return await readCollectorSession(identity);
      case 'activity':
        return await readCollectorActivity({ ...identity, activityId: input.selection.activityId });
      case 'trace':
        return await readCollectorTrace({ ...identity, traceId: input.selection.traceId });
    }
  } catch (error) {
    return capsuleFailure({ operation: 'observations', sessionId: input.sessionId, error });
  }
}

export async function readCapsuleSessionObservations(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): Promise<CollectorSessionReadResult | CapsuleOperationFailure> {
  const result = await readCapsuleObservations({ ...input, selection: { kind: 'session' } });
  switch (result.kind) {
    case 'collector-session-found':
    case 'collector-session-missing':
    case 'collector-session-corrupt':
    case 'capsule-not-found':
    case 'capsule-invalid-state':
    case 'capsule-operation-failed':
      return result;
    case 'collector-activity-found':
    case 'collector-activity-missing':
    case 'collector-activity-corrupt':
    case 'collector-trace-found':
    case 'collector-trace-missing':
    case 'collector-trace-corrupt':
      throw new Error(`Session observation query returned ${result.kind}`);
  }
}
