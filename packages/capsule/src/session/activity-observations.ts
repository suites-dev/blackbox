import type { CollectorActivityReadResult } from '@suites/blackbox-otel-collector-internal';
import { readCapsuleObservations } from './observations.js';

export async function readCapsuleActivityObservations(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activityId: string;
}): Promise<CollectorActivityReadResult> {
  const result = await readCapsuleObservations({
    ...input,
    selection: { kind: 'activity', activityId: input.activityId },
  });
  switch (result.kind) {
    case 'collector-activity-found':
      return await activityTraces(input, result);
    case 'collector-activity-missing':
    case 'collector-activity-corrupt':
      return result;
    default:
      throw new Error(`Activity observation query returned ${result.kind}`);
  }
}

async function activityTraces(
  input: {
    readonly projectDirectory: string;
    readonly sessionId: string;
  },
  activity: Extract<CollectorActivityReadResult, { readonly kind: 'collector-activity-found' }>,
): Promise<CollectorActivityReadResult> {
  const traces = await Promise.all(
    activity.traceIds.map((traceId) =>
      readCapsuleObservations({ ...input, selection: { kind: 'trace', traceId } }),
    ),
  );
  const fragments = [];
  for (const trace of traces) {
    switch (trace.kind) {
      case 'collector-trace-found':
        fragments.push(...trace.fragments);
        break;
      case 'collector-trace-missing':
        return {
          kind: 'collector-activity-missing',
          activityId: activity.activityId,
          identity: activity.identity,
          message: 'An exact linked trace was not retained.',
        };
      case 'collector-trace-corrupt':
        return {
          kind: 'collector-activity-corrupt',
          activityId: activity.activityId,
          identity: activity.identity,
          error: trace.error,
        };
      default:
        throw new Error(`Trace observation query returned ${trace.kind}`);
    }
  }
  return { ...activity, fragments };
}
