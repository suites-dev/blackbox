import { randomUUID } from 'node:crypto';

import { managerRequest } from '../ipc/client.js';
import { readCapsuleProgress } from '../progress/store.js';
import { projectCapsuleReport } from '../reporting/document.js';
import { redactStandaloneError } from '../reporting/redaction.js';
import type { CapsuleReportArtifact, CapsuleReportResult } from '../reporting/types.js';
import { readCapsuleActivities } from '../records.js';
import { readCapsuleSessionObservations } from './observations.js';
import { readCapsuleActivityObservations } from './activity-observations.js';
import type {
  CapsuleExecInput,
  CapsuleExecResult,
  CapsuleReportInput,
  CapsuleStopInput,
  CapsuleStopResult,
} from '../types.js';
import {
  canonicalProjectDirectory,
  capsuleFailure,
  isFailure,
  readRecordOrNotFound,
  validateSessionId,
} from './validation.js';

function assertNever(value: never): never {
  throw new Error(`Unhandled Capsule response: ${JSON.stringify(value)}`);
}

export async function execCapsule(input: CapsuleExecInput): Promise<CapsuleExecResult> {
  try {
    validateSessionId(input.sessionId);
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    const record = await readRecordOrNotFound({ projectDirectory, sessionId: input.sessionId });
    if (isFailure(record)) {
      return record;
    }
    if (record.state !== 'running') {
      return {
        kind: 'capsule-invalid-state',
        sessionId: input.sessionId,
        state: record.state,
        message: `Cannot execute against Capsule in ${record.state} state`,
      };
    }
    const response = await managerRequest({
      socketPath: record.socketPath,
      request: { kind: 'exec-request', requestId: randomUUID(), target: input.target },
    });
    switch (response.kind) {
      case 'exec-response':
        return { kind: 'capsule-exec-completed', outcome: response.outcome };
      case 'manager-error-response':
        return {
          kind: 'capsule-operation-failed',
          operation: 'exec',
          sessionId: input.sessionId,
          error: response.error,
        };
      case 'stop-response':
        throw new Error('Capsule manager returned a stop response for exec');
      default:
        return assertNever(response);
    }
  } catch (error) {
    return capsuleFailure({ operation: 'exec', sessionId: input.sessionId, error });
  }
}

export async function stopCapsule(input: CapsuleStopInput): Promise<CapsuleStopResult> {
  try {
    validateSessionId(input.sessionId);
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    const record = await readRecordOrNotFound({ projectDirectory, sessionId: input.sessionId });
    if (isFailure(record)) {
      return record;
    }
    if (record.state === 'stopped') {
      return {
        kind: 'capsule-stopped',
        sessionId: input.sessionId,
        cleanup: 'complete',
        alreadyStopped: true,
      };
    }
    if (record.state !== 'running' && record.state !== 'stop-failed') {
      return {
        kind: 'capsule-invalid-state',
        sessionId: input.sessionId,
        state: record.state,
        message: `Cannot stop Capsule in ${record.state} state`,
      };
    }
    const response = await managerRequest({
      socketPath: record.socketPath,
      request: { kind: 'stop-request', requestId: randomUUID(), reason: input.reason },
    });
    switch (response.kind) {
      case 'stop-response':
        return {
          kind: 'capsule-stopped',
          sessionId: input.sessionId,
          cleanup: response.cleanup,
          alreadyStopped: false,
        };
      case 'manager-error-response':
        return {
          kind: 'capsule-operation-failed',
          operation: 'stop',
          sessionId: input.sessionId,
          error: response.error,
        };
      case 'exec-response':
        throw new Error('Capsule manager returned an exec response for stop');
      default:
        return assertNever(response);
    }
  } catch (error) {
    return capsuleFailure({ operation: 'stop', sessionId: input.sessionId, error });
  }
}

export async function reportCapsule(input: CapsuleReportInput): Promise<CapsuleReportResult> {
  let artifact: CapsuleReportArtifact = 'session';
  try {
    validateSessionId(input.sessionId);
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    const record = await readRecordOrNotFound({ projectDirectory, sessionId: input.sessionId });
    if (isFailure(record)) {
      return record;
    }
    artifact = 'activities';
    const activities = await readCapsuleActivities({
      projectDirectory,
      sessionId: input.sessionId,
    });
    artifact = 'progress';
    const progress = await readCapsuleProgress({ projectDirectory, sessionId: input.sessionId });
    artifact = 'observations';
    const observations = await readCapsuleSessionObservations({
      projectDirectory,
      sessionId: input.sessionId,
    });
    if (
      observations.kind === 'capsule-not-found' ||
      observations.kind === 'capsule-invalid-state' ||
      observations.kind === 'capsule-operation-failed'
    ) {
      return observations;
    }
    return {
      kind: 'capsule-report',
      document: projectCapsuleReport({
        record,
        activities,
        progress,
        observations,
        activityObservations: await Promise.all(
          activities.map((activity) =>
            readCapsuleActivityObservations({
              projectDirectory,
              sessionId: input.sessionId,
              activityId: activity.activityId,
            }),
          ),
        ),
      }),
    };
  } catch (error) {
    return {
      kind: 'capsule-report-artifact-failed',
      sessionId: input.sessionId,
      artifact,
      error: redactStandaloneError(error),
    };
  }
}
