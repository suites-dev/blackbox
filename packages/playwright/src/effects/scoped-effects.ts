import { selectionBatches, type SelectionInput } from '../activities/execution/selection-batches.js';
import { createScopedObservationSource } from '../activities/scoped-observations.js';
import { createEffectContractEvaluator } from './evaluation/evaluator.js';
import { createBlackboxEffects } from './runtime.js';

/** Internal composition seam for a fixed, registry-owned activity selection. */
export function createScopedBlackboxEffects(input: {
  readonly selection: SelectionInput;
  readonly storageDirectory: string;
}) {
  const { scope } = selectionBatches(input.selection);
  return createBlackboxEffects({
    sessionId: scope.sessionId,
    executionId: scope.executionId,
    evaluator: createEffectContractEvaluator(createScopedObservationSource(input)),
  });
}
