import { describe, expect, it } from 'vitest';

import { sentenceMatcher } from '../sentences/match.js';
import { errorsOf, featureWith, SELECTED, testSentences } from './testing/context.js';

// Requirements: every step matches exactly one sentence of the list passed in
// as plain data, with the values its parameter types accept and the doc string
// or data table it declares; a sentence needing a capability the runtime does
// not offer is an error; a step that needs a completion barrier has one before
// it; and every scenario has at least one Then. Each error names
// file:line:column.

const scenario = (...steps: readonly string[]) =>
  featureWith(SELECTED, ['  Scenario: probe', ...steps.map((step) => `    ${step}`)].join('\n'));

const at = (line: number, column: number, message: string) =>
  `features/probe.feature:${line}:${column}: ${message}`;

describe('sentence and value matching', () => {
  it('accepts steps that match one sentence each', () => {
    expect(
      errorsOf(
        scenario(
          'Given the account "alice" exists',
          'When the client sends GET "/health"',
          'Then the response status is 200',
        ),
      ),
    ).toEqual([]);
  });

  it('rejects a step that matches no sentence', () => {
    expect(
      errorsOf(
        scenario('When the agent invents a convenient step', 'Then the response status is 200'),
      ),
    ).toEqual([
      at(
        5,
        5,
        'undefined step "When the agent invents a convenient step"; only sentences of the step library are allowed',
      ),
    ]);
  });

  it('rejects a step that matches two sentences', () => {
    expect(
      errorsOf(scenario('When the client sends GET "/health"', 'Then the queue "orders" is empty')),
    ).toEqual([
      at(
        6,
        5,
        'ambiguous step "Then the queue "orders" is empty" matches "the queue {string} is empty", "the queue {word} is empty"',
      ),
    ]);
  });

  it('rejects a value its parameter type does not accept, built-in or declared by pattern', () => {
    const source = scenario(
      'When the client sends GET "/health"',
      'Then the response status is two hundred',
      'And the response has 3 items at /data',
      'And the response has 3 items at data',
    );
    expect(errorsOf(source)).toEqual([
      at(
        6,
        5,
        'undefined step "Then the response status is two hundred"; only sentences of the step library are allowed',
      ),
      at(
        8,
        5,
        'undefined step "And the response has 3 items at data"; only sentences of the step library are allowed',
      ),
    ]);
  });

  it('checks each Examples row with its own values, at the step line', () => {
    const body = [
      '  Scenario Outline: probe <status>',
      '    When the client sends GET "/health"',
      '    Then the response status is <status>',
      '    Examples:',
      '      | status |',
      '      | 200    |',
      '      | OK     |',
    ].join('\n');
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([
      at(
        6,
        5,
        'undefined step "Then the response status is OK"; only sentences of the step library are allowed',
      ),
    ]);
  });
});

describe('doc strings, data tables and the sentence list', () => {
  it('rejects a missing or unexpected doc string or data table', () => {
    const source = scenario(
      'When the client sends POST "/subscriptions" with JSON:',
      'Then the response status is 200',
      '  """',
      '  200',
      '  """',
    );
    expect(errorsOf(source)).toEqual([
      at(
        5,
        5,
        'step "When the client sends POST "/subscriptions" with JSON:" expects a doc string but has no doc string or data table',
      ),
      at(
        6,
        5,
        'step "Then the response status is 200" expects no doc string or data table but has a doc string',
      ),
    ]);
  });

  it('refuses a sentence list that defines an expression twice', () => {
    const list = testSentences();
    expect(() =>
      sentenceMatcher({ ...list, sentences: [...list.sentences, list.sentences[0]] }),
    ).toThrow(
      'The sentence list of @example/step-library defines "the account {string} exists" twice',
    );
  });
});

describe('capability checks', () => {
  it('rejects a sentence whose capability the runtime does not offer, naming it', () => {
    const source = scenario(
      'Given the "postgres" participant runs SQL:',
      '  """sql',
      '  SELECT 1;',
      '  """',
      'When the client sends GET "/health"',
      'Then the response status is 200',
    );
    expect(errorsOf(source)).toEqual([
      at(
        5,
        5,
        'step "Given the "postgres" participant runs SQL:" needs capability "participant-exec", which this Blackbox runtime does not offer',
      ),
    ]);
    expect(errorsOf(source, ['participant-exec'])).toEqual([]);
  });
});

describe('barrier checks', () => {
  const effects = ['  | quantifier | kind |', '  | exists     | http |'];

  it('rejects a step that needs a barrier when none comes before it', () => {
    const source = scenario(
      'When the client sends GET "/health"',
      'Then the effects satisfy:',
      ...effects,
      'And the flow is sealed by the terminal response',
    );
    expect(errorsOf(source, ['effects-claims'])).toEqual([
      at(6, 5, 'step "Then the effects satisfy:" needs a completion barrier step before it'),
    ]);
  });

  it('accepts it after a barrier in the scenario or in a Background', () => {
    expect(
      errorsOf(
        scenario(
          'When the client sends GET "/health"',
          'Then the flow is sealed by the terminal response',
          'And the effects satisfy:',
          ...effects,
        ),
        ['effects-claims'],
      ),
    ).toEqual([]);
    const background = [
      '  Background:',
      '    Given the client sends GET "/health"',
      '    And the flow is sealed by the terminal response',
      '  Scenario: probe',
      '    Then the effects satisfy:',
      ...effects.map((row) => `      ${row}`),
    ].join('\n');
    expect(errorsOf(featureWith(SELECTED, background), ['effects-claims'])).toEqual([]);
  });

  it('reports the capability and the missing barrier together', () => {
    const source = scenario(
      'When the client sends GET "/health"',
      'Then the effects satisfy:',
      ...effects,
    );
    expect(errorsOf(source)).toEqual([
      at(
        6,
        5,
        'step "Then the effects satisfy:" needs capability "effects-claims", which this Blackbox runtime does not offer',
      ),
      at(6, 5, 'step "Then the effects satisfy:" needs a completion barrier step before it'),
    ]);
  });
});

describe('every scenario has a Then', () => {
  it('rejects a scenario without one, at the scenario', () => {
    expect(
      errorsOf(scenario('Given the account "alice" exists', 'When the client sends GET "/health"')),
    ).toEqual([at(4, 3, '"probe" has no Then step; a scenario needs at least one Then')]);
  });

  it('does not count a Then in the Background or a step written with *', () => {
    const body = [
      '  Background:',
      '    Then the response status is 200',
      '  Scenario: probe',
      '    When the client sends GET "/health"',
      '    * the response status is 200',
    ].join('\n');
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([
      at(6, 3, '"probe" has no Then step; a scenario needs at least one Then'),
    ]);
  });

  it('accepts And and But that continue a Then, and checks every Examples row', () => {
    expect(
      errorsOf(
        scenario(
          'When the client sends GET "/health"',
          'Then the response status is 200',
          'But the queue orders is empty',
        ),
      ),
    ).toEqual([]);
    const outline = [
      '  Scenario Outline: probe <path>',
      '    When the client sends GET "<path>"',
      '    Examples:',
      '      | path |',
      '      | /a   |',
    ].join('\n');
    expect(errorsOf(featureWith(SELECTED, outline))).toEqual([
      at(4, 3, '"probe /a" has no Then step; a scenario needs at least one Then'),
    ]);
  });
});
