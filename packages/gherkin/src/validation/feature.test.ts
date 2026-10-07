import { describe, expect, it } from 'vitest';

import { errorsOf, featureWith, SELECTED } from './testing/context.js';

// Requirements: a feature parses with the official Cucumber parser, declares a
// Feature with at least one scenario, and selects exactly one declared catalog
// entry (@system:) and one Sandbox profile of blackbox.feature.yaml
// (@sandbox:). Scenarios have steps, outlines have rows, and titles are unique.
// Each error names file:line:column.

const at = (line: number, column: number, message: string) =>
  `features/probe.feature:${line}:${column}: ${message}`;

const STEPS = ['    When the client sends GET "/health"', '    Then the response status is 200'];
const scenario = (title: string, ...steps: readonly string[]) =>
  [`  Scenario: ${title}`, ...steps].join('\n');

describe('structure', () => {
  it('rejects a parse error, an empty file and a feature without scenarios', () => {
    const stray = '  Scenario: probe\n    When the client sends GET "/health"\n    Not a step line';
    expect(errorsOf(featureWith(SELECTED, stray))).toEqual([
      at(
        6,
        5,
        "expected: #EOF, #TableRow, #DocStringSeparator, #StepLine, #TagLine, #ExamplesLine, #ScenarioLine, #RuleLine, #Comment, #Empty, got 'Not a step line'",
      ),
    ]);
    expect(errorsOf('# nothing here\n')).toEqual([at(1, 1, 'the file declares no Feature')]);
    expect(errorsOf(featureWith(SELECTED, ''))).toEqual([
      at(2, 1, '"Feature: probe" declares no scenario'),
    ]);
  });

  it('accepts a feature whose scenarios are all inside Rules', () => {
    expect(
      errorsOf(
        featureWith(
          SELECTED,
          `  Rule: grouped\n\n  ${scenario('probe', ...STEPS).replaceAll('\n', '\n  ')}`,
        ),
      ),
    ).toEqual([]);
  });

  it('rejects a scenario without steps and an outline without Examples rows', () => {
    expect(errorsOf(featureWith(SELECTED, scenario('probe')))).toEqual([
      at(4, 3, '"Scenario: probe" has no steps'),
    ]);
    const outline = [
      '  Scenario Outline: probe <path>',
      '    When the client sends GET "<path>"',
      '    Then the response status is 200',
      '    Examples:',
      '      | path |',
    ];
    expect(errorsOf(featureWith(SELECTED, outline.join('\n')))).toEqual([
      at(4, 3, '"Scenario Outline: probe <path>" has no Examples rows and would yield no test'),
    ]);
  });

  it('rejects duplicate titles of scenarios, outline rows and Rules', () => {
    const body = [
      scenario('same', ...STEPS),
      scenario('same', ...STEPS),
      '  Scenario Outline: row',
      '    When the client sends GET "<path>"',
      '    Then the response status is 200',
      '    Examples:',
      '      | path |',
      '      | /c   |',
      '      | /c   |',
      '  Rule: twice',
      `  ${scenario('a', ...STEPS).replaceAll('\n', '\n  ')}`,
      '  Rule: twice',
      `  ${scenario('b', ...STEPS).replaceAll('\n', '\n  ')}`,
    ].join('\n');
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([
      at(7, 3, 'duplicate title "same" (also at line 4); emitted tests need unique titles'),
      at(
        16,
        7,
        'duplicate title "row [path=/c]" (also at line 15); emitted tests need unique titles',
      ),
      at(
        21,
        3,
        'duplicate title "Rule: twice" (also at line 17); emitted tests need unique titles',
      ),
    ]);
  });
});

describe('selection', () => {
  const body = scenario('probe', ...STEPS);

  it('rejects a feature without @system: or @sandbox:', () => {
    expect(errorsOf(featureWith('', body))).toEqual([
      at(2, 1, 'missing @system: tag; a Feature needs exactly one @system: tag'),
      at(2, 1, 'missing @sandbox: tag; a Feature needs exactly one @sandbox: tag'),
    ]);
  });

  it('rejects two systems and two sandboxes', () => {
    expect(errorsOf(featureWith(`${SELECTED} @system:payment-mock @sandbox:bare`, body))).toEqual([
      at(
        1,
        46,
        'a Feature needs exactly one @system: tag; found @system:subscription-system and @system:payment-mock',
      ),
      at(
        1,
        67,
        'a Feature needs exactly one @sandbox: tag; found @sandbox:default and @sandbox:bare',
      ),
    ]);
  });

  it('rejects an unknown catalog entry and an unknown Sandbox profile', () => {
    expect(errorsOf(featureWith('@system:no-such-entry @sandbox:nightly', body))).toEqual([
      at(
        1,
        1,
        '@system:no-such-entry names no catalog entry (known: payment-mock, subscription-system)',
      ),
      at(1, 23, '@sandbox:nightly names no Sandbox profile (known: bare, default)'),
    ]);
  });
});
