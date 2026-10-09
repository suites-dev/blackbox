import { describe, expect, it } from 'vitest';

import { parseGherkin } from './parse.js';

const source = `# author comment
@feature
Feature: complete syntax
  A feature description.

  Background: feature setup
    Given a feature setup

  Rule: one business rule
    A rule description.

    Background: rule setup
      Given a rule setup

    @example
    Example: ordinary
      When an action happens
      Then a claim holds
      And another claim holds
      But an exception holds
      * a wildcard step
      And a table:
        | name | value |
        | a    | b     |
      And a document:
        """json
        {"ok":true}
        """

    @outline
    Scenario Outline: expanded <name>
      Given a value "<name>"
      Then it is observed

      @examples
      Examples: cases
        | name |
        | one  |
        | two  |
`;

describe('canonical Gherkin parsing', () => {
  it('retains syntax and expands outlines with inherited backgrounds and tags', () => {
    const { document, pickles } = parseGherkin(source, 'complete.feature');
    const feature = document.feature!;
    expect(document.comments.map((comment) => comment.text)).toEqual(['# author comment']);
    expect(feature.keyword).toBe('Feature');
    expect(feature.description.trim()).toBe('A feature description.');
    expect(feature.children[0].background!.keyword).toBe('Background');
    const rule = feature.children[1].rule!;
    expect(rule.keyword).toBe('Rule');
    expect(rule.description.trim()).toBe('A rule description.');
    expect(rule.children[0].background!.name).toBe('rule setup');
    const scenario = rule.children[1].scenario!;
    expect(scenario.keyword).toBe('Example');
    expect(scenario.steps.map((step) => step.keyword.trim())).toEqual([
      'When',
      'Then',
      'And',
      'But',
      '*',
      'And',
      'And',
    ]);
    expect(
      scenario.steps[5].dataTable!.rows.map((row) => row.cells.map((cell) => cell.value)),
    ).toEqual([
      ['name', 'value'],
      ['a', 'b'],
    ]);
    expect(scenario.steps[6].docString).toMatchObject({
      content: '{"ok":true}',
      mediaType: 'json',
    });
    expect(rule.children[2].scenario!.keyword).toBe('Scenario Outline');
    expect(pickles.map((pickle) => pickle.name)).toEqual([
      'ordinary',
      'expanded one',
      'expanded two',
    ]);
    expect(pickles[1].steps.map((step) => step.text)).toEqual([
      'a feature setup',
      'a rule setup',
      'a value "one"',
      'it is observed',
    ]);
    expect(pickles[1].tags.map((tag) => tag.name)).toEqual(['@feature', '@outline', '@examples']);
    expect(parseGherkin(source, 'complete.feature')).toEqual({ document, pickles });
  });

  it('accepts Scenario aliases and both doc string delimiters', () => {
    const parsed = parseGherkin(
      'Feature: aliases\n  Scenario: simple\n    Given text:\n      ```text/plain\n      hello\n      ```\n',
      'aliases.feature',
    );
    expect(parsed.document.feature!.children[0].scenario!.keyword).toBe('Scenario');
    expect(parsed.pickles[0].steps[0].argument!.docString).toMatchObject({
      content: 'hello',
      mediaType: 'text/plain',
    });
  });

  it('honors localized keywords and rejects unknown languages and malformed syntax', () => {
    const parsed = parseGherkin(
      '# language: fr\nFonctionnalité: service\n  Scénario: disponible\n    Soit un service\n    Quand une action\n    Alors une réponse\n',
      'fr.feature',
    );
    expect(parsed.document.feature!.language).toBe('fr');
    expect(parsed.document.feature!.keyword).toBe('Fonctionnalité');
    expect(parsed.pickles[0].steps.map((step) => step.text)).toEqual([
      'un service',
      'une action',
      'une réponse',
    ]);
    expect(() => parseGherkin('# language: invented\nFeature: broken\n', 'bad.feature')).toThrow();
    expect(() => parseGherkin('Scenario: missing feature\n Given a step\n', 'bad.feature')).toThrow(
      /1:1/u,
    );
  });
});
