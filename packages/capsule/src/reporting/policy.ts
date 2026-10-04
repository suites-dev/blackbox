import type { CapsuleActivityReport } from '../model/execution/activity.js';
import type { CapsuleProgressEvent } from '../progress/events.js';
import type { CapsuleReportObservationPolicy } from './types.js';

/**
 * The observation policy the capsule started with, from its progress, with a
 * status per boundary. Capsule records observations; it does not evaluate
 * whether a boundary was satisfied, so every boundary is `not-evaluated`.
 * Capsules started before the policy was recorded report `not-recorded`.
 */
export function projectObservationPolicy(
  progress: readonly CapsuleProgressEvent[],
): CapsuleReportObservationPolicy {
  const resolved = progress.find((event) => event.kind === 'observation-policy-resolved');
  if (resolved === undefined) {
    return { kind: 'not-recorded' };
  }
  const { policy } = resolved;
  return {
    kind: 'recorded',
    policyId: policy.policyId,
    terminalObservationWindowMs: policy.terminalObservationWindowMs,
    redaction: policy.redaction,
    requiredBoundaries: policy.requiredBoundaries,
    boundaries: policy.boundaries.map((boundary) => ({
      id: boundary.id,
      kind: boundary.kind,
      authoritativeFor: boundary.authoritativeFor,
      required: policy.requiredBoundaries.includes(boundary.id),
      status: 'not-evaluated',
    })),
  };
}

function latest(times: readonly string[]): string {
  return times.reduce((left, right) => (Date.parse(right) > Date.parse(left) ? right : left));
}

/**
 * When the session's retained evidence last changed: the record, an activity
 * starting or completing, or a progress event. The record alone is not
 * rewritten when an activity is recorded.
 */
export function evidenceUpdatedAt(input: {
  readonly recordUpdatedAt: string;
  readonly activities: readonly CapsuleActivityReport[];
  readonly progress: readonly CapsuleProgressEvent[];
}): string {
  return latest([
    input.recordUpdatedAt,
    ...input.activities.flatMap((activity) =>
      activity.kind === 'running'
        ? [activity.startedAt]
        : [activity.startedAt, activity.completedAt],
    ),
    ...input.progress.map((event) => event.at),
  ]);
}
