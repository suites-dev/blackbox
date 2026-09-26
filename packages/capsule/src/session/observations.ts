import {
  readCollectorSession,
  readCollectorSnapshot,
  readCollectorTrace,
  readCollectorTraces,
  projectCollectorActivity,
  projectCollectorSession,
  projectCollectorTraces,
  type CollectorActivityReadResult,
  type CollectorIdentity,
  type CollectorSessionReadResult,
  type CollectorTracesReadResult,
} from '@suites/blackbox-otel-collector-internal';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox-internal';

import {
  capsuleSandboxRecordDirectory,
  readCapsuleActivities,
  type CapsuleSessionRecord,
} from '../records.js';
import type {
  CapsuleActivityReport,
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

function collectorIdentity(input: {
  readonly projectDirectory: string;
  readonly record: CapsuleSessionRecord;
}): CollectorIdentity & { readonly storageDirectory: string } {
  return {
    sessionId: input.record.sessionId,
    executionId: input.record.executionId,
    storageDirectory: sandboxTelemetryStorageDirectory({
      recordDirectory: capsuleSandboxRecordDirectory({
        projectDirectory: input.projectDirectory,
        sessionId: input.record.sessionId,
      }),
      sandboxId: input.record.executionId,
    }),
  };
}

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
    const identity = collectorIdentity({ projectDirectory, record });
    switch (input.selection.kind) {
      case 'session':
        return await readCollectorSession(identity);
      case 'activity':
        return await readActivityScope({
          identity,
          projectDirectory,
          sessionId: input.sessionId,
          activityId: input.selection.activityId,
        });
      case 'trace':
        return await readCollectorTrace({ ...identity, traceId: input.selection.traceId });
    }
  } catch (error) {
    return capsuleFailure({ operation: 'observations', sessionId: input.sessionId, error });
  }
}

export async function readCapsuleTraceObservations(input: {
  readonly projectDirectory: string;
  readonly record: CapsuleSessionRecord;
}): Promise<CollectorTracesReadResult> {
  return readCollectorTraces(collectorIdentity(input));
}

export async function readCapsuleReportObservations(input: {
  readonly projectDirectory: string;
  readonly record: CapsuleSessionRecord;
  readonly activities: readonly CapsuleActivityReport[];
}) {
  const snapshot = await readCollectorSnapshot(collectorIdentity(input));
  return {
    observations: projectCollectorSession(snapshot),
    traceObservations: projectCollectorTraces(snapshot),
    activityObservations: input.activities.map((activity) =>
      projectCollectorActivity({
        snapshot,
        activityId: activity.activityId,
        traceId: activity.telemetry.context.traceId,
      }),
    ),
  };
}

async function readActivityScope(input: {
  readonly identity: CollectorIdentity & { readonly storageDirectory: string };
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activityId: string;
}): Promise<CollectorActivityReadResult> {
  const activities = await readCapsuleActivities(input);
  const activity = activities.find((candidate) => candidate.activityId === input.activityId);
  if (activity === undefined) {
    return {
      kind: 'collector-activity-missing',
      identity: input.identity,
      activityId: input.activityId,
      message: 'The Capsule activity does not exist.',
    };
  }
  const traceId = activity.telemetry.context.traceId;
  const trace = await readCollectorTrace({ ...input.identity, traceId });
  if (trace.kind === 'collector-trace-found') {
    return {
      kind: 'collector-activity-found',
      identity: trace.identity,
      activityId: input.activityId,
      fragments: trace.fragments,
      traceIds: [traceId],
    };
  }
  return trace.kind === 'collector-trace-missing'
    ? {
        kind: 'collector-activity-missing',
        identity: trace.identity,
        activityId: input.activityId,
        message: 'No spans were retained for the activity execution scope.',
      }
    : {
        kind: 'collector-activity-corrupt',
        identity: trace.identity,
        activityId: input.activityId,
        error: trace.error,
      };
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
