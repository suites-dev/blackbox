import { freezeOwned } from '../boundary/ownership.js';
import { verifySelectedCount } from '../verification/counts.js';
import { assessment, complete, filterSelection, unavailable } from './assessment.js';
import type {
  EffectEmissionPredicate,
  EffectRecorder,
  EffectRecorderCount,
  EffectRecorderCountAssessment,
} from './model.js';
import { recorderState } from './ownership.js';

export function assessEffectRecorder(
  recorder: EffectRecorder,
  constraint: EffectRecorderCount,
  predicate?: EffectEmissionPredicate,
): EffectRecorderCountAssessment {
  const state = recorderState(recorder);
  if (
    !['exactly', 'atLeast', 'atMost'].includes(constraint.operator) ||
    !Number.isSafeInteger(constraint.count) ||
    constraint.count < 0
  ) {
    throw new TypeError('Expected an emission count operator and a nonnegative safe integer');
  }
  if (!recorder.available) {
    return freezeOwned({ ...unavailable(recorder), lowerBound: 0, upperBound: null });
  }
  const selected = filterSelection(state.selection, predicate);
  const closed = complete(recorder);
  const finding = verifySelectedCount(selected, closed, {
    op: constraint.operator,
    n: constraint.count,
  });
  return freezeOwned({
    ...assessment(
      recorder,
      finding,
      selected.possible.map((effect) => effect.id),
    ),
    lowerBound: selected.definite.length,
    upperBound: closed ? selected.definite.length + selected.possible.length : null,
  });
}
