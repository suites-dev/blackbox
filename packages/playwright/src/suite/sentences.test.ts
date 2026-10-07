import { describe, expect, it } from 'vitest';

import { library } from '../library/index.js';
import { matchSentence } from './match.js';
import { sentences } from './sentences.js';

// Requirement: the step library's sentences are exported as plain data, one
// per library step in library order, each with exactly its expression, its
// parameter types (name and pattern, in order), the capability it needs,
// whether it needs a barrier, and an example that matches it.

const INT = { name: 'int', pattern: String.raw`(?:-?\d+)|(?:\d+)` };
const STRING = {
  name: 'string',
  pattern: String.raw`"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'`,
};
const WORD = { name: 'word', pattern: String.raw`[^\s]+` };

describe('sentences', () => {
  it('lists every library step in library order, as plain data', () => {
    expect(sentences.map((sentence) => sentence.expression)).toEqual(
      library.vocabulary.map((entry) => entry.expression),
    );
    expect(JSON.parse(JSON.stringify(sentences))).toEqual(sentences);
    for (const sentence of sentences) {
      expect(Object.keys(sentence).sort()).toEqual([
        'example',
        'expression',
        'needsBarrier',
        'parameterTypes',
        'requires',
      ]);
    }
  });

  it('describes each sentence field by field', () => {
    const byExpression = new Map(sentences.map((sentence) => [sentence.expression, sentence]));
    expect(
      byExpression.get('the client has sent {word} {string} with JSON and received {int}:'),
    ).toEqual({
      expression: 'the client has sent {word} {string} with JSON and received {int}:',
      parameterTypes: [WORD, STRING, INT],
      requires: null,
      needsBarrier: false,
      example: 'the client has sent POST "/subscriptions" with JSON and received 201:',
    });
    expect(byExpression.get('the flow is sealed by the terminal response(s)')).toEqual({
      expression: 'the flow is sealed by the terminal response(s)',
      parameterTypes: [],
      requires: null,
      needsBarrier: false,
      example: 'the flow is sealed by the terminal response',
    });
    expect(byExpression.get('the effects satisfy:')).toEqual({
      expression: 'the effects satisfy:',
      parameterTypes: [],
      requires: 'effects-claims',
      needsBarrier: true,
      example: 'the effects satisfy:',
    });
    expect(byExpression.get('the {string} participant runs SQL:')).toMatchObject({
      parameterTypes: [STRING],
      requires: 'participant-exec',
      needsBarrier: false,
    });
  });

  it('needs a barrier only for effects claims', () => {
    const needing = sentences
      .filter((sentence) => sentence.needsBarrier)
      .map((sentence) => sentence.expression);
    expect(needing).toEqual(
      library.vocabulary
        .filter((entry) => entry.kind === 'effects-claim')
        .map((entry) => entry.expression),
    );
  });

  it('gives each sentence an example that matches it and no other', () => {
    for (const sentence of sentences) {
      expect(matchSentence(sentences, sentence.example), sentence.example).toMatchObject({
        kind: 'known',
        expression: sentence.expression,
      });
    }
  });
});
