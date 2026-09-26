import type {
  CollectorActivityReadResult,
  CollectorSessionReadResult,
  CollectorSnapshotReadResult,
  CollectorTraceReadResult,
  CollectorTracesReadResult,
} from '../../model/types.js';
import { validateTraceId } from '../../model/validation.js';

export function projectCollectorSession(
  snapshot: CollectorSnapshotReadResult,
): CollectorSessionReadResult {
  switch (snapshot.kind) {
    case 'collector-snapshot-found':
      return {
        kind: 'collector-session-found',
        lifecycle: snapshot.lifecycle,
        fragments: snapshot.fragments,
        traceIds: snapshot.traces.map(({ traceId }) => traceId),
      };
    case 'collector-snapshot-missing':
      return { ...snapshot, kind: 'collector-session-missing' };
    case 'collector-snapshot-corrupt':
      return { ...snapshot, kind: 'collector-session-corrupt' };
  }
}

export function projectCollectorTraces(
  snapshot: CollectorSnapshotReadResult,
): CollectorTracesReadResult {
  switch (snapshot.kind) {
    case 'collector-snapshot-found':
      return {
        kind: 'collector-traces-found',
        identity: snapshot.identity,
        traces: snapshot.traces,
      };
    case 'collector-snapshot-missing':
      return { ...snapshot, kind: 'collector-traces-missing' };
    case 'collector-snapshot-corrupt':
      return { ...snapshot, kind: 'collector-traces-corrupt' };
  }
}

export function projectCollectorTrace(input: {
  readonly snapshot: CollectorSnapshotReadResult;
  readonly traceId: string;
}): CollectorTraceReadResult {
  const traceId = validateTraceId(input.traceId);
  const snapshot = input.snapshot;
  if (snapshot.kind === 'collector-snapshot-corrupt') {
    return { ...snapshot, kind: 'collector-trace-corrupt', traceId };
  }
  if (snapshot.kind === 'collector-snapshot-missing') {
    return { ...snapshot, kind: 'collector-trace-missing', traceId };
  }
  const trace = snapshot.traces.find((candidate) => candidate.traceId === traceId);
  return trace === undefined
    ? {
        kind: 'collector-trace-missing',
        identity: snapshot.identity,
        traceId,
        message: 'No retained spans exist for the exact trace ID.',
      }
    : { kind: 'collector-trace-found', identity: snapshot.identity, ...trace };
}

export function projectCollectorActivity(input: {
  readonly snapshot: CollectorSnapshotReadResult;
  readonly activityId: string;
  readonly traceId: string;
}): CollectorActivityReadResult {
  const trace = projectCollectorTrace(input);
  if (trace.kind === 'collector-trace-found') {
    return {
      kind: 'collector-activity-found',
      identity: trace.identity,
      activityId: input.activityId,
      fragments: trace.fragments,
      traceIds: [trace.traceId],
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
