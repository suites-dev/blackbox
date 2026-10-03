import {
  projectCollectorActivity,
  readCollectorSnapshot,
  type CollectorSnapshotReadResult,
} from '@suites/blackbox-otel-collector';

import type {
  EffectObservationReadResult,
  EffectObservationSource,
} from '../effects/evaluation/source.js';
import { requireTrustedSelection } from './activity-registry.js';
import { createPayloadAdmission } from './admission.js';
import { freezeActivityData, type ActivityProvenance, type ActivitySelection } from './types.js';

type Admitted = Extract<EffectObservationReadResult, { readonly kind: 'admitted' }>;
export type ScopedObservationReadResult =
  | Exclude<EffectObservationReadResult, Admitted>
  | (Admitted & {
      readonly scope: ActivitySelection;
      readonly provenance: Readonly<Record<string, readonly ActivityProvenance[]>>;
    });

export interface ScopedObservationSource extends EffectObservationSource {
  read(): Promise<ScopedObservationReadResult>;
}

function admitSnapshot(
  snapshot: Extract<CollectorSnapshotReadResult, { kind: 'collector-snapshot-found' }>,
  selection: ActivitySelection,
): ScopedObservationReadResult {
  const payloads: unknown[] = [];
  const diagnostics = ['explicit-activity-trace-admission', 'trusted-manifest-not-authenticated'];
  const admission = createPayloadAdmission(selection);
  try {
    for (const activity of selection.activities) {
      for (const traceId of activity.traceIds) {
        if (snapshot.traces.filter((trace) => trace.traceId === traceId).length > 1) {
          throw new TypeError('Duplicate trace entry in activity snapshot.');
        }
        const observation = projectCollectorActivity({
          snapshot,
          activityId: activity.activityId,
          traceId,
        });
        if (observation.kind === 'collector-activity-missing') {
          diagnostics.push(`activity-trace-not-received:${activity.activityId}:${traceId}`);
          continue;
        }
        if (observation.kind !== 'collector-activity-found') {
          throw new TypeError('Activity telemetry projection was rejected.');
        }
        for (const fragment of observation.fragments) {
          payloads.push(admission.admit(fragment.request, activity));
        }
      }
    }
  } catch (error) {
    return {
      kind: 'rejected',
      message: error instanceof Error ? error.message : 'Activity payload admission failed.',
    };
  }
  return freezeActivityData({
    kind: 'admitted',
    scopeId: selection.scopeId,
    payloads,
    diagnostics,
    scope: selection,
    provenance: admission.provenance,
  });
}

export function createScopedObservationSource(
  input: {
    readonly selection: ActivitySelection;
    readonly storageDirectory: string;
  },
  ports: { readonly readSnapshot: typeof readCollectorSnapshot } = {
    readSnapshot: readCollectorSnapshot,
  },
): ScopedObservationSource {
  requireTrustedSelection(input.selection);
  const selection = input.selection;
  const identity = Object.freeze({
    sessionId: selection.sessionId,
    executionId: selection.executionId,
    storageDirectory: input.storageDirectory,
  });
  return Object.freeze({
    async read(): Promise<ScopedObservationReadResult> {
      let snapshot;
      try {
        snapshot = await ports.readSnapshot(identity);
      } catch {
        return { kind: 'unavailable', message: 'Activity telemetry snapshot could not be read.' };
      }
      if (
        snapshot.identity.sessionId !== identity.sessionId ||
        snapshot.identity.executionId !== identity.executionId
      ) {
        return {
          kind: 'rejected',
          message: 'Activity telemetry identity does not match its trusted selection.',
        };
      }
      if (snapshot.kind === 'collector-snapshot-missing') {
        return { kind: 'unavailable', message: 'No retained activity telemetry snapshot exists.' };
      }
      if (snapshot.kind === 'collector-snapshot-corrupt') {
        return { kind: 'rejected', message: 'Retained activity telemetry snapshot is corrupt.' };
      }
      return admitSnapshot(snapshot, selection);
    },
  });
}
