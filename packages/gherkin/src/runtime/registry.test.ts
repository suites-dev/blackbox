import { describe, expect, it } from 'vitest';

import { createStepLibrary } from './registry.js';
import type { StepDefinition } from './step-types.js';

// Requirement: the library is closed and resolves text to exactly one
// definition; a step whose capability the runtime does not offer is
// unavailable (capability gate, task 2.2).

const run = () => Promise.resolve();

function definition(expression: string, requires: StepDefinition['requires'] = null): StepDefinition {
  return {
    expression,
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires,
    credentialParameter: null,
    deadlineParameter: null,
    example: expression,
    run,
  };
}

const definitions = [
  definition('the response status is {int}'),
  definition('the effects are exactly {int}', 'effects-claims'),
  definition('the user {string} exists'),
  definition('the user {word} exists'),
];

describe('createStepLibrary', () => {
  it('resolves one definition and converts its parameters', () => {
    const library = createStepLibrary({ name: 'n', version: '1', definitions, capabilities: [] });
    expect(library.resolve('the response status is 201')).toEqual({
      status: 'resolved',
      definition: definitions[0],
      parameters: [201],
    });
  });

  it('reports undefined and ambiguous text', () => {
    const library = createStepLibrary({ name: 'n', version: '1', definitions, capabilities: [] });
    expect(library.resolve('the response is fine')).toEqual({ status: 'undefined' });
    expect(library.resolve('the user "ann" exists')).toEqual({
      status: 'ambiguous',
      expressions: ['the user {string} exists', 'the user {word} exists'],
    });
  });

  it('gates a step on its capability', () => {
    const closed = createStepLibrary({ name: 'n', version: '1', definitions, capabilities: [] });
    expect(closed.resolve('the effects are exactly 1')).toEqual({
      status: 'unavailable',
      definition: definitions[1],
      capability: 'effects-claims',
    });
    const open = createStepLibrary({ name: 'n', version: '1', definitions, capabilities: ['effects-claims'] });
    expect(open.resolve('the effects are exactly 1')).toMatchObject({ status: 'resolved', parameters: [1] });
    expect(open.capabilities).toEqual(['effects-claims']);
  });

  it('identifies the vocabulary by content, independent of order and step bodies', () => {
    const first = createStepLibrary({ name: 'n', version: '1', definitions, capabilities: [] });
    const reordered = createStepLibrary({
      name: 'n',
      version: '1',
      definitions: [...definitions].reverse().map((entry) => ({ ...entry, run: () => Promise.resolve() })),
      capabilities: [],
    });
    const changed = createStepLibrary({
      name: 'n',
      version: '1',
      definitions: [...definitions.slice(1), definition('the response status is {int}', 'participant-exec')],
      capabilities: [],
    });
    expect(first.identity.vocabularyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(reordered.identity.vocabularyHash).toBe(first.identity.vocabularyHash);
    expect(changed.identity.vocabularyHash).not.toBe(first.identity.vocabularyHash);
  });

  it('refuses a vocabulary that defines one expression twice', () => {
    expect(() =>
      createStepLibrary({ name: 'n', version: '1', definitions: [definitions[0], definitions[0]], capabilities: [] }),
    ).toThrow('Step library defines "the response status is {int}" twice');
  });
});
