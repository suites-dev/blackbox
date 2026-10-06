import { describe, expect, it } from 'vitest';

import { diagnosticsOf, featureWith, SELECTED } from '../testing/context.js';

// Requirements: undefined, ambiguous and capability-gated steps are compile
// errors (hard rule 3, §4.3); a scenario needs a claim and an effects claim
// needs a barrier (§4.4); selection names exactly one declared catalog entry
// and Sandbox profile (§2.2, §2.3).

const scenario = (...steps: readonly string[]) =>
  featureWith(SELECTED, ['  Scenario: probe', ...steps.map((step) => `    ${step}`)].join('\n'));

const at = (line: number, column: number, message: string) =>
  `features/probe.feature:${line}:${column}: ${message}`;

describe('step resolution against the closed library', () => {
  it('rejects an undefined step', () => {
    expect(diagnosticsOf(scenario('When the agent invents a convenient step', 'Then the response status is 200'))).toEqual([
      at(5, 5, 'undefined step "When the agent invents a convenient step"; only steps from the shared Blackbox step library are allowed'),
    ]);
  });

  it('rejects an ambiguous step', () => {
    expect(diagnosticsOf(scenario('When the client sends GET "/health"', 'Then the queue "orders" is empty'))).toEqual([
      at(6, 5, 'ambiguous step "Then the queue "orders" is empty" matches "the queue {string} is empty", "the queue {word} is empty"'),
    ]);
  });

  it('rejects an effects claim while the runtime does not offer effects verdicts', () => {
    const source = scenario(
      'When the client sends GET "/health"',
      'Then the flow is sealed by the terminal response',
      'And the effects satisfy:',
      '  | quantifier | kind | operation | target  |',
      '  | exactly 1  | http | GET       | /health |',
    );
    expect(diagnosticsOf(source)).toEqual([
      at(7, 5, 'step "And the effects satisfy:" needs capability "effects-claims", which this Blackbox runtime does not offer'),
    ]);
  });

  it('rejects a participant SQL step while the runtime cannot exec in a participant', () => {
    const source = scenario('Given the "postgres" participant runs SQL:', '  """sql', '  SELECT 1;', '  """', 'When the client sends GET "/health"', 'Then the response status is 200');
    expect(diagnosticsOf(source)).toEqual([
      at(5, 5, 'step "Given the "postgres" participant runs SQL:" needs capability "participant-exec", which this Blackbox runtime does not offer'),
    ]);
  });

  it('rejects a missing or unexpected doc string or data table', () => {
    const source = scenario('When the client sends POST "/subscriptions" with JSON:', 'Then the response status is 200', '  """', '  200', '  """');
    expect(diagnosticsOf(source)).toEqual([
      at(5, 5, 'step "When the client sends POST "/subscriptions" with JSON:" expects a doc string but has no doc string or data table'),
      at(6, 5, 'step "Then the response status is 200" expects no doc string or data table but has a doc string'),
    ]);
  });
});

describe('scenario structure', () => {
  it('rejects a scenario without a claim', () => {
    expect(diagnosticsOf(scenario('When the client sends GET "/health"'))).toEqual([
      at(4, 3, '"Scenario: probe" makes no claim; a scenario needs at least one response, state or effects claim step'),
    ]);
  });

  it('rejects a scenario without steps', () => {
    expect(diagnosticsOf(scenario())).toEqual([at(4, 3, '"Scenario: probe" has no steps')]);
  });

  it('rejects an effects claim without an earlier barrier, even when the capability is offered', () => {
    const source = scenario('When the client sends GET "/health"', 'Then the effects satisfy:', '  | quantifier | kind |', '  | exists     | http |', 'And the flow is sealed by the terminal response');
    expect(diagnosticsOf(source, ['effects-claims'])).toEqual([
      at(6, 5, 'effects claim "Then the effects satisfy:" needs a completion barrier step before it'),
    ]);
  });

  it('accepts an effects claim after a barrier when the capability is offered', () => {
    const source = scenario('When the client sends GET "/health"', 'Then the flow is sealed by the terminal response', 'And the effects satisfy:', '  | quantifier | kind |', '  | exists     | http |');
    expect(diagnosticsOf(source, ['effects-claims'])).toEqual([]);
  });

  it('rejects an outline whose Examples have no rows', () => {
    const body = ['  Scenario Outline: probe <path>', '    When the client sends GET "<path>"', '    Then the response status is 200', '    Examples:', '      | path |'].join('\n');
    expect(diagnosticsOf(featureWith(SELECTED, body))).toEqual([
      at(4, 3, '"Scenario Outline: probe <path>" has no Examples rows and would compile to no test'),
    ]);
  });

  it('rejects duplicate titles, including identical outline rows', () => {
    const body = [
      '  Scenario: same', '    When the client sends GET "/a"', '    Then the response status is 200',
      '  Scenario: same', '    When the client sends GET "/b"', '    Then the response status is 200',
      '  Scenario Outline: row', '    When the client sends GET "<path>"', '    Then the response status is 200',
      '    Examples:', '      | path |', '      | /c   |', '      | /c   |',
    ].join('\n');
    expect(diagnosticsOf(featureWith(SELECTED, body))).toEqual([
      at(7, 3, 'duplicate title "Scenario: same" (also at line 4); Playwright requires unique titles'),
      at(10, 3, 'duplicate title "Scenario: row [path=/c]" (also at line 10); Playwright requires unique titles'),
    ]);
  });

  it('rejects a feature without scenarios, an empty file and a parse error', () => {
    expect(diagnosticsOf(featureWith(SELECTED, ''))).toEqual([at(2, 1, '"Feature: probe" declares no scenario')]);
    expect(diagnosticsOf('# nothing here\n')).toEqual([at(1, 1, 'the file declares no Feature')]);
    const stray = '  Scenario: probe\n    When the client sends GET "/health"\n    Not a step line';
    expect(diagnosticsOf(featureWith(SELECTED, stray))).toEqual([
      at(6, 5, "expected: #EOF, #TableRow, #DocStringSeparator, #StepLine, #TagLine, #ExamplesLine, #ScenarioLine, #RuleLine, #Comment, #Empty, got 'Not a step line'"),
    ]);
  });
});

describe('selection', () => {
  const body = '  Scenario: probe\n    When the client sends GET "/health"\n    Then the response status is 200';

  it('rejects a feature without @system: or @sandbox:', () => {
    expect(diagnosticsOf(featureWith('', body))).toEqual([
      at(2, 1, 'missing @system: tag; a Feature needs exactly one @system: tag'),
      at(2, 1, 'missing @sandbox: tag; a Feature needs exactly one @sandbox: tag'),
    ]);
    expect(diagnosticsOf(featureWith('@sandbox:default', body))).toEqual([
      at(2, 1, 'missing @system: tag; a Feature needs exactly one @system: tag'),
    ]);
    expect(diagnosticsOf(featureWith('@system:subscription-system', body))).toEqual([
      at(2, 1, 'missing @sandbox: tag; a Feature needs exactly one @sandbox: tag'),
    ]);
  });

  it('rejects two systems, two sandboxes and duplicate selection tags', () => {
    expect(diagnosticsOf(featureWith(`${SELECTED} @system:payment-mock @sandbox:bare @sandbox:default`, body))).toEqual([
      at(1, 46, 'a Feature needs exactly one @system: tag; found @system:subscription-system and @system:payment-mock'),
      at(1, 67, 'a Feature needs exactly one @sandbox: tag; found @sandbox:default and @sandbox:bare'),
      at(1, 81, 'duplicate tag "@sandbox:default"'),
    ]);
  });

  it('rejects an unknown catalog entry and an unknown Sandbox profile', () => {
    expect(diagnosticsOf(featureWith('@system:no-such-entry @sandbox:nightly', body))).toEqual([
      at(1, 1, '@system:no-such-entry names no catalog entry (known: payment-mock, subscription-system)'),
      at(1, 23, '@sandbox:nightly names no Sandbox profile (known: bare, default)'),
    ]);
  });
});

describe('named credentials (task 2.4)', () => {
  const claim = (credential: string) => `Then the state at "/fixture/state" as "${credential}" has 1 item`;

  it('accepts a credential the Sandbox profile defines', () => {
    expect(diagnosticsOf(scenario('When the client sends GET "/health"', claim('fixture-control')))).toEqual([]);
  });

  it('rejects a credential the Sandbox profile does not define, naming the ones it does', () => {
    expect(diagnosticsOf(scenario('When the client sends GET "/health"', claim('admin')))).toEqual([
      at(6, 5, 'credential "admin" is not defined by Sandbox profile "default" (it defines fixture-control)'),
    ]);
    const bare = featureWith(
      '@system:subscription-system @sandbox:bare',
      ['  Scenario: probe', '    When the client sends GET "/health"', `    ${claim('fixture-control')}`].join('\n'),
    );
    expect(diagnosticsOf(bare)).toEqual([
      at(6, 5, 'credential "fixture-control" is not defined by Sandbox profile "bare" (it defines none)'),
    ]);
  });

  it('reports only the unknown profile when the Feature selects none', () => {
    const unknown = featureWith(
      '@system:subscription-system @sandbox:nightly',
      ['  Scenario: probe', '    When the client sends GET "/health"', `    ${claim('admin')}`].join('\n'),
    );
    expect(diagnosticsOf(unknown)).toEqual([
      at(1, 29, '@sandbox:nightly names no Sandbox profile (known: bare, default)'),
    ]);
  });
});
