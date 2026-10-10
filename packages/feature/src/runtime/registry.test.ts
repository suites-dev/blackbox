import { describe, expect, it } from 'vitest';

import { createStepLibrary } from './registry.js';
import type { StepDefinition } from './step-types.js';

// Requirement: the library is closed and resolves text to exactly one
// definition; a step whose capability the runtime does not offer is
// unavailable (capability gate, task 2.2). Its definitions are deep-frozen,
// bodies included, and its hash covers the bodies (rule-dodging F1).

const run = () => Promise.resolve();

function definition(
  expression: string,
  requires: StepDefinition['requires'] = null,
): StepDefinition {
  return {
    expression,
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires,
    credentialParameter: null,
    deadlineParameter: null,
    example: expression,
    check: null,
    run,
  };
}

const definitions = [
  definition('the response status is {int}'),
  definition('the effects are exactly {int}', 'effects-claims'),
  definition('the user {string} exists'),
  definition('the user {word} exists'),
];

describe('step resolution', () => {
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
    const open = createStepLibrary({
      name: 'n',
      version: '1',
      definitions,
      capabilities: ['effects-claims'],
    });
    expect(open.resolve('the effects are exactly 1')).toMatchObject({
      status: 'resolved',
      parameters: [1],
    });
    expect(open.capabilities).toEqual(['effects-claims']);
  });
});

describe('library identity and immutability', () => {
  it('identifies the library by content and step bodies, independent of order', () => {
    const first = createStepLibrary({ name: 'n', version: '1', definitions, capabilities: [] });
    const reordered = createStepLibrary({
      name: 'n',
      version: '1',
      // A new function with the same source is the same body.
      definitions: [...definitions]
        .reverse()
        .map((entry) => ({ ...entry, run: () => Promise.resolve() })),
      capabilities: [],
    });
    const changed = createStepLibrary({
      name: 'n',
      version: '1',
      definitions: [
        ...definitions.slice(1),
        definition('the response status is {int}', 'participant-exec'),
      ],
      capabilities: [],
    });
    const rebodied = createStepLibrary({
      name: 'n',
      version: '1',
      definitions: [
        { ...definitions[0], run: () => Promise.reject(new Error('another body')) },
        ...definitions.slice(1),
      ],
      capabilities: [],
    });
    expect(first.identity.vocabularyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(reordered.identity.vocabularyHash).toBe(first.identity.vocabularyHash);
    expect(changed.identity.vocabularyHash).not.toBe(first.identity.vocabularyHash);
    expect(rebodied.identity.vocabularyHash).not.toBe(first.identity.vocabularyHash);
  });

  it('deep-freezes the definitions it is built from, bodies included', () => {
    const own = [definition('the order {string} exists')];
    const library = createStepLibrary({
      name: 'n',
      version: '1',
      definitions: own,
      capabilities: [],
    });
    expect(Object.isFrozen(own)).toBe(true);
    expect(Object.isFrozen(own[0].fixtures)).toBe(true);
    expect(Object.isFrozen(own[0].run)).toBe(true);
    expect(() => {
      (own[0] as { run: StepDefinition['run'] }).run = () => Promise.resolve();
    }).toThrow(TypeError);
    expect(library.resolve('the order "o-1" exists')).toMatchObject({ definition: { run } });
  });

  it('refuses a vocabulary that defines one expression twice', () => {
    expect(() =>
      createStepLibrary({
        name: 'n',
        version: '1',
        definitions: [definitions[0], definitions[0]],
        capabilities: [],
      }),
    ).toThrow('Step library defines "the response status is {int}" twice');
  });
});
