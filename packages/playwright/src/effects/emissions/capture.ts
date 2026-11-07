import { randomUUID } from 'node:crypto';
import {
  createEffectCapture, projectEffects, type EffectCapture, type EffectCaptureIdentity,
} from '@suites/blackbox-effects';

import { createEffectSnapshotArtifact } from '../evaluation/artifact.js';
import type { EffectSnapshotArtifact } from '../evaluation/artifact-types.js';
import type { EffectObservationSource } from '../evaluation/source.js';

export interface CapturedEffects {
  readonly capture: EffectCapture;
  readonly evidence: EffectSnapshotArtifact | null;
}
export type EffectCaptureProvider = () => Promise<CapturedEffects>;

export function unavailableEffectCapture(input: {
  readonly sessionId: string; readonly executionId: string; readonly message: string;
}): CapturedEffects {
  return {
    capture: createEffectCapture({
      identity: {
        sessionId: input.sessionId, executionId: input.executionId,
        scopeId: input.executionId, captureId: randomUUID(), activityIds: [],
      },
      unavailable: { reason: input.message },
    }),
    evidence: null,
  };
}

/** One read, one projection, one immutable cut. Later collector writes cannot change it. */
export async function captureEffectObservations(input: {
  readonly identity: Omit<EffectCaptureIdentity, 'captureId'>;
  readonly source: EffectObservationSource;
}): Promise<CapturedEffects> {
  const identity = { ...input.identity, captureId: randomUUID() };
  const read = await input.source.read();
  if (read.kind !== 'admitted') {
    return {
      capture: createEffectCapture({ identity, unavailable: { reason: read.message } }),
      evidence: null,
    };
  }
  try {
    const graph = projectEffects({ format: 'otlp-json', scopeId: read.scopeId, payloads: read.payloads });
    const capture = createEffectCapture({ graph, identity });
    return { capture, evidence: createEffectSnapshotArtifact({ read, graph }) };
  } catch (error) {
    if (!(error instanceof TypeError)) { throw error; }
    return {
      capture: createEffectCapture({ identity, unavailable: { reason: `Observation rejected: ${error.message}` } }),
      evidence: null,
    };
  }
}
