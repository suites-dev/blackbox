import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
} from '@cucumber/cucumber-expressions';

import type { Sentence, SentenceList } from './model.js';

export type SentenceMatch =
  | {
      readonly status: 'matched';
      readonly sentence: Sentence;
      /** The parameter values, in order, as text; a {string} is given without its quotes. */
      readonly values: readonly string[];
    }
  | { readonly status: 'undefined' }
  | { readonly status: 'ambiguous'; readonly expressions: readonly string[] };

export type SentenceMatcher = (text: string) => SentenceMatch;

interface CompiledSentence {
  readonly sentence: Sentence;
  readonly expression: CucumberExpression;
}

/** Each sentence gets its own registry, so two sentences may name different types alike. */
function compile(sentence: Sentence): CompiledSentence {
  const registry = new ParameterTypeRegistry();
  for (const type of sentence.parameterTypes) {
    registry.defineParameterType(
      new ParameterType(
        type.name,
        new RegExp(type.pattern, 'u'),
        String,
        (value: string) => value,
        false,
        false,
      ),
    );
  }
  return { sentence, expression: new CucumberExpression(sentence.expression, registry) };
}

/**
 * Compiles a sentence list once. A list that repeats an expression or holds
 * one that is not a valid Cucumber expression is a fault of the library that
 * produced it, so it throws instead of becoming a feature error.
 */
export function sentenceMatcher(list: SentenceList): SentenceMatcher {
  const seen = new Set<string>();
  const compiled = list.sentences.map((sentence) => {
    if (seen.has(sentence.expression)) {
      throw new Error(
        `The sentence list of ${list.library.name} defines ${JSON.stringify(sentence.expression)} twice`,
      );
    }
    seen.add(sentence.expression);
    return compile(sentence);
  });
  return (text) => {
    const matches = compiled.flatMap((candidate) => {
      const args = candidate.expression.match(text);
      return args === null ? [] : [{ sentence: candidate.sentence, args }];
    });
    if (matches.length === 0) {
      return { status: 'undefined' };
    }
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        expressions: matches.map((match) => match.sentence.expression),
      };
    }
    const [{ sentence, args }] = matches;
    return { status: 'matched', sentence, values: args.map((arg) => String(arg.getValue(null))) };
  };
}
