import { effect, graph } from '../../verification/test-fixtures/graphs.js';
import type { EffectGraph, ObservedEffect } from '../../graph/model.js';
import { createEffectCapture } from '../create.js';

export { effect, graph };

export const identity = {
  sessionId: 'session',
  executionId: 'attempt-1',
  scopeId: 'fixture',
  captureId: 'cut-1',
  activityIds: ['stimulus-1'],
};

/** Completeness here is an explicit verifier fixture, never a collector completion claim. */
export function capture(effects: readonly ObservedEffect[], fields: Partial<EffectGraph> = {}) {
  return createEffectCapture({ identity, graph: graph(effects, fields) });
}
