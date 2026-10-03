import type { ActivitySelection } from '../activities/types.js';
import { createScopedObservationSource } from '../activities/scoped-observations.js';
import { createEffectContractEvaluator } from './evaluation/evaluator.js';
import { createBlackboxEffects } from './runtime.js';

/** Internal composition seam for a fixed, registry-owned activity selection. */
export function createScopedBlackboxEffects(input: {
  readonly selection: ActivitySelection;
  readonly storageDirectory: string;
}) {
  return createBlackboxEffects({
    sessionId: input.selection.sessionId,
    executionId: input.selection.executionId,
    evaluator: createEffectContractEvaluator(createScopedObservationSource(input)),
  });
}
