import { freezeOwned } from '../boundary/ownership.js';
import type { EffectRelation, EffectSelection, ObservedEffect } from '../graph/model.js';
import type { VerificationFinding } from '../verification/model.js';
import type { EffectEmissionPredicate, EffectRecorder, EffectRecorderAssessment } from './model.js';

export function predicateResult(predicate: EffectEmissionPredicate, effect: ObservedEffect) {
  const result: unknown = predicate(effect);
  if (result !== true && result !== false && result !== null) {
    throw new TypeError('An emission predicate must return true, false, or null');
  }
  return result;
}

export function filterSelection(
  selection: EffectSelection,
  predicate: EffectEmissionPredicate | undefined,
): EffectSelection {
  if (predicate === undefined) {
    return selection;
  }
  const definite: ObservedEffect[] = [];
  const possible: ObservedEffect[] = [];
  for (const effect of selection.definite) {
    const match = predicateResult(predicate, effect);
    if (match === true) {
      definite.push(effect);
    } else if (match === null) {
      possible.push(effect);
    }
  }
  for (const effect of selection.possible) {
    if (predicateResult(predicate, effect) !== false) {
      possible.push(effect);
    }
  }
  return { definite, possible };
}

export function complete(recorder: EffectRecorder): boolean {
  return recorder.coverage.closed && recorder.coverage.coverage === 'complete';
}

export function assessment(
  recorder: EffectRecorder,
  finding: VerificationFinding,
  possibleEvidence: readonly string[] = [],
  relations: readonly EffectRelation[] = [],
): EffectRecorderAssessment {
  return freezeOwned({
    ...finding,
    possibleEvidence: [...possibleEvidence],
    relations: [...relations],
    identity: recorder.identity,
    coverage: recorder.coverage,
  });
}

export function unavailable(recorder: EffectRecorder): EffectRecorderAssessment {
  return assessment(recorder, {
    status: 'inconclusive',
    reason: recorder.unavailableReason ?? 'Observation unavailable',
    evidence: [],
  });
}
