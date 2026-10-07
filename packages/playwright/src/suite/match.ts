import { compileExpression } from '../step-runtime/support/cucumber-expression.js';
import type { StepValue } from './outline.js';
import type { Sentence } from './sentences.js';

/** A step text that is exactly one library sentence, with its values. */
export interface KnownSentence {
  readonly kind: 'known';
  readonly expression: string;
  readonly values: readonly StepValue[];
}

/** A step text no sentence matches, or more than one does: it has no library call. */
export interface UnknownSentence {
  readonly kind: 'unknown';
}

export type SentenceMatch = KnownSentence | UnknownSentence;

const UNKNOWN = Object.freeze({ kind: 'unknown' }) satisfies UnknownSentence;

/** Matches step text against the sentence list, as the step library resolves it. */
export function matchSentence(sentences: readonly Sentence[], text: string): SentenceMatch {
  const matches = sentences.flatMap((sentence) => {
    const values = compileExpression(sentence.expression).match(text);
    return values === null ? [] : [{ expression: sentence.expression, values }];
  });
  if (matches.length !== 1) {
    return UNKNOWN;
  }
  const [{ expression, values }] = matches;
  return { kind: 'known', expression, values: values as readonly StepValue[] };
}
