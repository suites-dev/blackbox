import { InconclusiveAssertionError } from '../../assertions/types.js';
import type { ExpectMatcherState, MatcherReturnType } from '@playwright/test';
import {
  assessEffectRecorder, assessEffectRecorderBefore, assessNthEffectEmission,
} from '@suites/blackbox-effects';

import { emissionPredicate } from './payload.js';
import { recorderOwner } from './ownership.js';
import type { ExpectedEmission } from './types.js';
import { resolveEmission, type EmissionEvaluation } from './lazy/resolve.js';
import type { EmissionSelection } from './lazy/types.js';
import { lazySelection } from './lazy/selection.js';

type Verification = {
  readonly context: ExpectMatcherState;
  readonly recorder: EmissionSelection;
  readonly matcher: string;
  readonly expected: unknown;
  readonly evaluate: EmissionEvaluation;
} & Readonly<Partial<{ other: EmissionSelection }>>;

async function reportVerification(input: Verification) {
  const { recorder, other, assessment } = await resolveEmission({ ...input, other: input.other, timeout: input.context.timeout });
  const owner = recorderOwner(recorder);
  const expected = input.context.utils.stringify(input.expected);
  const ids = new Set([...assessment.evidence, ...assessment.possibleEvidence]);
  const candidates = [...recorder.emissions, ...recorder.possibleEmissions,
    ...(other === undefined ? [] : [...other.emissions, ...other.possibleEmissions])];
  const witnesses = [...new Map(candidates.filter(({ id }) => ids.has(id)).map((effect) => [effect.id, effect])).values()];
  await owner.report({
    matcher: input.matcher, expected, negated: input.context.isNot, assessment,
    evidence: owner.evidence, witnesses,
    otherCapture: other === undefined ? null : other.identity,
  });
  return { assessment, owner, expected };
}

async function verify(input: Verification): Promise<MatcherReturnType> {
  const selection = lazySelection(input.recorder);
  const { assessment, owner, expected } = await (selection === undefined
    ? reportVerification(input) : selection.provider.run(() => reportVerification(input)));
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
  async toHaveEmitted(this: ExpectMatcherState, received: EmissionSelection) {
    return verify({ context: this, recorder: received, matcher: 'toHaveEmitted', expected: undefined,
      evaluate: (recorder) => assessEffectRecorder(recorder, { operator: 'atLeast', count: 1 }) });
  },
  async toHaveEmittedTimes(this: ExpectMatcherState, received: EmissionSelection, count: number) {
    return verify({ context: this, recorder: received, matcher: 'toHaveEmittedTimes', expected: count,
      evaluate: (recorder) => assessEffectRecorder(recorder, { operator: 'exactly', count }) });
  },
  async toHaveEmittedWith(this: ExpectMatcherState, received: EmissionSelection, expected: ExpectedEmission) {
    const predicate = emissionPredicate(expected);
    return verify({ context: this, recorder: received, matcher: 'toHaveEmittedWith', expected,
      evaluate: (recorder) => assessEffectRecorder(recorder, { operator: 'atLeast', count: 1 }, predicate) });
  },
  async toHaveEmittedBefore(this: ExpectMatcherState, received: EmissionSelection, other: EmissionSelection) {
    return verify({ context: this, recorder: received, matcher: 'toHaveEmittedBefore', expected: other.selector, other,
      evaluate: (recorder, compared) => {
        if (compared === undefined) { throw new TypeError('Missing effect ordering operand'); }
        return assessEffectRecorderBefore(recorder, compared);
      } });
  },
  async toHaveNthEmittedWith(this: ExpectMatcherState, received: EmissionSelection, ordinal: number, expected: ExpectedEmission) {
    const predicate = emissionPredicate(expected);
    return verify({ context: this, recorder: received, matcher: 'toHaveNthEmittedWith', expected: { ordinal, ...expected },
      evaluate: (recorder) => assessNthEffectEmission(recorder, ordinal, predicate) });
  },
};
