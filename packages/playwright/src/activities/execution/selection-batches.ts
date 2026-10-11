import { createHash } from 'node:crypto';

import { requireTrustedSelection } from '../activity-registry.js';
import { activityAdmissionLimits } from '../limits.js';
import { freezeActivityData, type ActivitySelection } from '../types.js';

export type SelectionInput = ActivitySelection | readonly ActivitySelection[];

/** Validate each bounded admission manifest; the union is reporting data, not a new trusted selection. */
export function selectionBatches(input: SelectionInput): {
  readonly batches: readonly ActivitySelection[];
  readonly scope: ActivitySelection;
} {
  const batches: readonly ActivitySelection[] = Array.isArray(input)
    ? input
    : [input as ActivitySelection];
  if (batches.length === 0) {
    throw new TypeError('At least one trusted activity selection is required.');
  }
  for (const batch of batches) {
    requireTrustedSelection(batch);
  }
  const first = batches[0];
  const activities = batches.flatMap((batch) => {
    if (
      batch.sessionId !== first.sessionId ||
      batch.executionId !== first.executionId ||
      batch.kind !== first.kind
    ) {
      throw new TypeError('Activity selection batches must share attempt identity and kind.');
    }
    return batch.activities;
  });
  if (activities.length > activityAdmissionLimits.registeredActivities) {
    throw new RangeError('Activity selection batches exceed the registration limit.');
  }
  const activityIds = new Set<string>();
  const traceIds = new Set<string>();
  for (const activity of activities) {
    if (
      activityIds.has(activity.activityId) ||
      activity.traceIds.some((trace) => traceIds.has(trace))
    ) {
      throw new TypeError('Activity selection batches contain duplicate ownership.');
    }
    activityIds.add(activity.activityId);
    activity.traceIds.forEach((trace) => traceIds.add(trace));
  }
  if (batches.length === 1) {
    return { batches: Object.freeze([...batches]), scope: first };
  }
  const manifest = {
    sessionId: first.sessionId,
    executionId: first.executionId,
    kind: first.kind,
    activities: activities.sort((left, right) => left.activityId.localeCompare(right.activityId)),
  };
  return {
    batches: Object.freeze([...batches]),
    scope: freezeActivityData({
      ...manifest,
      scopeId: `activity-batches-${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`,
    }),
  };
}
