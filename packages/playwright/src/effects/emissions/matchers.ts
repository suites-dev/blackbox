import { InconclusiveAssertionError } from '../../assertions/types.js';
import type { ExpectMatcherState, MatcherReturnType } from '@playwright/test';
import {
  assessEffectRecorder, assessEffectRecorderBefore, assessNthEffectEmission,
  type EffectRecorder, type EffectRecorderAssessment,
} from '@suites/blackbox-effects';

import { emissionPredicate } from './payload.js';
import { recorderOwner } from './ownership.js';
import type { ExpectedEmission } from './types.js';

function unavailable(recorder: EffectRecorder, reason: string): EffectRecorderAssessment {
  return {
    status: 'inconclusive', reason, identity: recorder.identity, coverage: recorder.coverage,
    evidence: [], possibleEvidence: [], relations: [],
  };
}

async function verify(input: {
  readonly context: ExpectMatcherState;
  readonly recorder: EffectRecorder;
  readonly matcher: string;
  readonly expected: unknown;
  readonly evaluate: () => EffectRecorderAssessment;
} & Readonly<Partial<{ other: EffectRecorder }>>): Promise<MatcherReturnType> {
  const owner = recorderOwner(input.recorder);
  const reason = owner.unavailable() ?? (input.other === undefined
    ? null : recorderOwner(input.other).unavailable());
  const assessment = reason === null ? input.evaluate() : unavailable(input.recorder, reason);
  const expected = input.context.utils.stringify(input.expected);
  const ids = new Set([...assessment.evidence, ...assessment.possibleEvidence]);
  const candidates = [...input.recorder.emissions, ...input.recorder.possibleEmissions,
    ...(input.other === undefined ? [] : [...input.other.emissions, ...input.other.possibleEmissions])];
  const witnesses = [...new Map(candidates.filter(({ id }) => ids.has(id)).map((effect) => [effect.id, effect])).values()];
  await owner.report({
    matcher: input.matcher, expected, negated: input.context.isNot, assessment,
    evidence: owner.evidence, witnesses,
    otherCapture: input.other === undefined ? null : input.other.identity,
  });
  const message = owner.describe(`Effect recorder ${input.matcher}: ${assessment.status}; ${assessment.reason}`);
  if (assessment.status === 'inconclusive') { throw new InconclusiveAssertionError(message); }
  return {
    pass: assessment.status === 'pass', actual: owner.describe(JSON.stringify(assessment)),
    expected: owner.describe(expected),
    message: () => assessment.status === 'pass'
      ? owner.describe(`Expected selected effects not to satisfy ${input.matcher}(${expected}). ${assessment.reason}`)
      : message,
  };
}

export const emissionMatchers = {
  async toHaveEmitted(this: ExpectMatcherState, received: EffectRecorder) {
    return verify({ context: this, recorder: received, matcher: 'toHaveEmitted', expected: undefined,
      evaluate: () => assessEffectRecorder(received, { operator: 'atLeast', count: 1 }) });
  },
  async toHaveEmittedTimes(this: ExpectMatcherState, received: EffectRecorder, count: number) {
    return verify({ context: this, recorder: received, matcher: 'toHaveEmittedTimes', expected: count,
      evaluate: () => assessEffectRecorder(received, { operator: 'exactly', count }) });
  },
  async toHaveEmittedWith(this: ExpectMatcherState, received: EffectRecorder, expected: ExpectedEmission) {
    const predicate = emissionPredicate(expected);
    return verify({ context: this, recorder: received, matcher: 'toHaveEmittedWith', expected,
      evaluate: () => assessEffectRecorder(received, { operator: 'atLeast', count: 1 }, predicate) });
  },
  async toHaveEmittedBefore(this: ExpectMatcherState, received: EffectRecorder, other: EffectRecorder) {
    return verify({ context: this, recorder: received, matcher: 'toHaveEmittedBefore', expected: other.selector, other,
      evaluate: () => assessEffectRecorderBefore(received, other) });
  },
  async toHaveNthEmittedWith(this: ExpectMatcherState, received: EffectRecorder, ordinal: number, expected: ExpectedEmission) {
    const predicate = emissionPredicate(expected);
    return verify({ context: this, recorder: received, matcher: 'toHaveNthEmittedWith', expected: { ordinal, ...expected },
      evaluate: () => assessNthEffectEmission(received, ordinal, predicate) });
  },
};
