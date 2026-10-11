import { createHash, randomUUID } from 'node:crypto';

import {
  createTelemetryExecutionScope,
  type TelemetryExecutionScope,
  type TelemetryScopeResult,
} from '@suites/blackbox-telemetry';

import { activityAdmissionLimits } from './limits.js';
import {
  freezeActivityData,
  type ActivityPurpose,
  type ActivitySelection,
  type OwnedActivity,
} from './types.js';

const trustedSelections = new WeakSet<ActivitySelection>();
const purposes = ['setup', 'stimulus', 'inspection'] satisfies readonly ActivityPurpose[];

export function requireTrustedSelection(selection: ActivitySelection): void {
  if (!trustedSelections.has(selection)) {
    throw new TypeError('Activity selection is not owned by a trusted activity registry.');
  }
}

function nonblank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function validateSelection(selection: {
  readonly kind: ActivitySelection['kind'];
  readonly activities: readonly OwnedActivity[];
}): void {
  if (
    !['stimulus', 'inspection', 'procedure'].includes(selection.kind) ||
    !isArray(selection.activities) ||
    selection.activities.length === 0
  ) {
    throw new TypeError('Select an explicit kind and at least one owned activity.');
  }
  if (selection.activities.length > activityAdmissionLimits.selectedTraces) {
    throw new RangeError('Activity selection exceeds eight traces.');
  }
}

/** Internal ownership boundary; its caller decides the enclosing fixture lifetime. */
export function createActivityRegistry(input: {
  readonly sessionId: string;
  readonly executionId: string;
}) {
  const { sessionId, executionId } = input;
  if (!nonblank(sessionId) || !nonblank(executionId)) {
    throw new TypeError('Activity registry requires session and execution identity.');
  }
  const owned = new WeakMap<OwnedActivity, TelemetryExecutionScope>();
  let registered = 0;
  return Object.freeze({
    begin(activity: { readonly purpose: ActivityPurpose; readonly name: string }): OwnedActivity {
      if (!purposes.includes(activity.purpose) || !nonblank(activity.name)) {
        throw new TypeError('Activity requires an explicit purpose and name.');
      }
      if (registered >= activityAdmissionLimits.registeredActivities) {
        throw new RangeError('Activity registry registration limit reached.');
      }
      const activityId = randomUUID();
      const scope = createTelemetryExecutionScope({
        executionId: activityId,
        operationName: activity.name,
      });
      const handle = freezeActivityData({
        activityId,
        purpose: activity.purpose,
        context: structuredClone(scope.active.context),
      });
      owned.set(handle, scope);
      registered++;
      return handle;
    },
    finish(activity: OwnedActivity, outcome: TelemetryScopeResult): void {
      const scope = owned.get(activity);
      if (scope === undefined) {
        throw new TypeError('Activity is not owned by this registry.');
      }
      // Completion records execution outcome only. It grants no capture completeness.
      scope.complete(outcome);
    },
    select(selection: {
      readonly kind: ActivitySelection['kind'];
      readonly activities: readonly OwnedActivity[];
    }): ActivitySelection {
      validateSelection(selection);
      const seen = new Set<OwnedActivity>();
      const activities = selection.activities
        .map((activity) => {
          if (!owned.has(activity)) {
            throw new TypeError('Activity is not owned by this registry.');
          }
          if (seen.has(activity)) {
            throw new TypeError('Activity selection contains a duplicate.');
          }
          seen.add(activity);
          if (selection.kind !== 'procedure' && activity.purpose !== selection.kind) {
            throw new TypeError('Activity purpose does not match the selected boundary.');
          }
          return {
            activityId: activity.activityId,
            purpose: activity.purpose,
            traceIds: [activity.context.traceId],
          };
        })
        .sort((left, right) => left.activityId.localeCompare(right.activityId));
      const manifest = { sessionId, executionId, kind: selection.kind, activities };
      const selected = freezeActivityData({
        scopeId: `activity-${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`,
        ...manifest,
      });
      trustedSelections.add(selected);
      return selected;
    },
  });
}
