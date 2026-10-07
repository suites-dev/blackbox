import { library } from '../library/index.js';
import type { Capability, StepVocabularyEntry } from '../step-runtime/library.js';
import {
  compileExpression,
  type SentenceParameterType,
} from '../step-runtime/support/cucumber-expression.js';

export type { Capability, SentenceParameterType };

/**
 * One sentence of the step library as plain data, for tools that do not load
 * step bodies: the Gherkin validator matches feature steps against it, and
 * suite rendering and drift decide which steps are library calls.
 */
export interface Sentence {
  /** The Cucumber expression, for example `the response status is {int}`. */
  readonly expression: string;
  /** The expression's parameters in order: each type's name and the pattern its text matches. */
  readonly parameterTypes: readonly SentenceParameterType[];
  /** The runtime capability the sentence needs, or null when every runtime offers it. */
  readonly requires: Capability | null;
  /** Whether a completion barrier step must run earlier in the scenario. */
  readonly needsBarrier: boolean;
  /** A step text that matches this sentence, for authors to copy. */
  readonly example: string;
}

export function sentenceOf(entry: StepVocabularyEntry): Sentence {
  return Object.freeze({
    expression: entry.expression,
    parameterTypes: Object.freeze(
      compileExpression(entry.expression).parameterTypes.map((type) => Object.freeze({ ...type })),
    ),
    requires: entry.requires,
    // An effects claim judges the whole flow, so it needs the flow sealed first.
    needsBarrier: entry.kind === 'effects-claim',
    example: entry.example,
  });
}

/** Every sentence of the shared step library, in library order. */
export const sentences: readonly Sentence[] = Object.freeze(library.vocabulary.map(sentenceOf));
