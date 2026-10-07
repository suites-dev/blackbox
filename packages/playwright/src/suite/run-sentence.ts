import { library } from '../library/index.js';
import type { StepLibrary } from '../step-runtime/library.js';
import type { StepArgument, StepFixtures } from '../step-runtime/step-types.js';
import type { StepValue } from './outline.js';

// The library call of a rendered suite step. The suite names the sentence by
// its expression and passes the feature's values, so nothing parses step text
// at run time. The step's own checks run first, as validation would have run
// them, and a sentence the installed library no longer has, or whose
// capability it does not offer, fails instead of running something else.

export type SentenceRunner = (
  fixtures: StepFixtures,
  expression: string,
  values: readonly StepValue[],
  argument: StepArgument,
) => Promise<void>;

export function createSentenceRunner(steps: StepLibrary): SentenceRunner {
  return async (fixtures, expression, values, argument) => {
    const resolution = steps.resolveSentence(expression, values);
    if (resolution.status === 'undefined' || resolution.status === 'ambiguous') {
      throw new Error(
        `The step library has no sentence ${JSON.stringify(expression)}; check the suite for drift`,
      );
    }
    if (resolution.status === 'unavailable') {
      throw new Error(
        `Sentence ${JSON.stringify(expression)} needs capability "${resolution.capability}", which this Blackbox runtime does not offer`,
      );
    }
    const { definition, parameters } = resolution;
    const problems = definition.check === null ? [] : definition.check({ parameters, argument });
    if (problems.length > 0) {
      throw new Error(`Sentence ${JSON.stringify(expression)}: ${problems.join('; ')}`);
    }
    await definition.run({ fixtures, parameters, argument });
  };
}

/** Runs one sentence of the shared step library: the body of a rendered library step. */
export const runSentence: SentenceRunner = createSentenceRunner(library);
