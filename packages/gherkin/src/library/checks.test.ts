import { describe, expect, it } from 'vitest';

import { FeatureCompileError } from '../compiler/planning/diagnostics.js';
import { planFeature } from '../compiler/planning/plan.js';
import { testCatalog } from '../compiler/testing/context.js';
import { library } from './index.js';
import { WORKED_EXAMPLE_PROFILE } from './testing/worked-examples.js';

// Requirement (benchmark finding F3): the compiler checks the values written
// in a feature, not only its step shapes, so a mistake costs a compile
// instead of a Sandbox acquisition. Each case is one the benchmark compiled
// with exit 0 (guardrails 7 to 13): invalid JSON in a stimulus or claim doc
// string, a path on another origin, a pointer without its leading slash, an
// HTTP method that cannot send JSON, deadlines of 0 seconds and 24 hours, and
// a text doc string on a JSON step. Each is now a compile error at its step.

const STATE = 'the state at "/fixture/state" as "fixture-control"';

/** Plans a scenario of `steps` against the shared library; returns its diagnostics, or [] when it compiles. */
function diagnostics(...steps: readonly string[]): readonly string[] {
  const source = ['@system:subscription-system @sandbox:default', 'Feature: probe', '', '  Scenario: probe', ...steps.map((step) => `    ${step}`)].join('\n');
  try {
    planFeature(`${source}\n`, 'features/probe.feature', {
      catalog: testCatalog,
      sandboxProfiles: { default: WORKED_EXAMPLE_PROFILE },
      library,
    });
    return [];
  } catch (error) {
    if (error instanceof FeatureCompileError) {
      return error.message.split('\n');
    }
    throw error;
  }
}

const at = (line: number, step: string, problem: string) => `features/probe.feature:${line}:5: step "${step}": ${problem}`;

const doc = (content: string, mediaType = 'json') => [`  """${mediaType}`, `  ${content}`, '  """'];

describe('compile-time checks of JSON and requests (benchmark F3)', () => {
  it('compiles values at the edge of every check', () => {
    expect(
      diagnostics(
        'When the client sends POST "/subscriptions?next=//other" with JSON:',
        ...doc('{"userId": "alice"}', ''),
        `Then the flow is sealed within 1 second when ${STATE} has 0 items at "/orders"`,
        `And the flow is sealed within 3600 seconds when ${STATE} has "" equal to:`,
        ...doc('{"subscriptions": [], "orders": []}'),
        'And the response has a value at ""',
        'And the response has "/a~1b/~0c" equal to:',
        ...doc('null'),
      ),
    ).toEqual([]);
  });

  it('invalid JSON in a stimulus or claim doc string', () => {
    const problems = diagnostics(
      'When the client sends POST "/subscriptions" with JSON:',
      ...doc('{"userId": "alice"'),
      'Then the response JSON equals:',
      ...doc('{"status": 0, "data": null'),
    );
    expect(problems).toEqual([
      expect.stringMatching(/^features\/probe\.feature:5:5: step "When the client sends POST "\/subscriptions" with JSON:": the doc string is not JSON \(.+\)$/u),
      expect.stringMatching(/^features\/probe\.feature:9:5: step "Then the response JSON equals:": the doc string is not JSON \(.+\)$/u),
    ]);
  });

  it('a text doc string on a JSON step', () => {
    expect(
      diagnostics('When the client sends POST "/subscriptions" with JSON:', ...doc('{}', 'text'), 'Then the response status is 201'),
    ).toEqual([
      at(5, 'When the client sends POST "/subscriptions" with JSON:', 'the doc string is typed "text"; this step takes an untyped or json doc string'),
    ]);
  });

  it('an HTTP method that cannot send JSON', () => {
    expect(
      diagnostics('When the client sends FETCH "/subscriptions" with JSON:', ...doc('{}'), 'Then the response status is 201'),
    ).toEqual([
      at(5, 'When the client sends FETCH "/subscriptions" with JSON:', 'HTTP method "FETCH" cannot send a JSON request; use POST, PUT, PATCH or DELETE'),
    ]);
  });

  it('every request of a concurrent table, and its header row', () => {
    const step = 'When the client sends these requests concurrently:';
    expect(
      diagnostics(
        step,
        '  | method | path         | json             |',
        '  | POST   | /subscriptions | {"userId": "a"} |',
        '  | FETCH  | //evil.example | {"userId": "b"  |',
        'Then the response statuses are "201, 409"',
      ),
    ).toEqual([
      at(5, step, 'request 2: HTTP method "FETCH" cannot send a JSON request; use POST, PUT, PATCH or DELETE'),
      at(5, step, 'request 2: request path "//evil.example" is not an absolute path on the Sandbox entrypoint, such as "/health"'),
      expect.stringMatching(/^features\/probe\.feature:5:5: step "When the client sends these requests concurrently:": request 2: the json cell is not JSON \(.+\)$/u),
    ]);
    expect(diagnostics(step, '  | method | url | body |', '  | POST | /a | {} |', 'Then the response statuses are "201"')).toEqual([
      at(5, step, 'the data table header row is | method | url | body |; it must be | method | path | json |'),
    ]);
  });
});

describe('compile-time checks of paths, pointers and deadlines (benchmark F3)', () => {
  it('a path on another origin, in a stimulus and in a state read', () => {
    // URLs read a backslash as a slash, so this path names the host evil.example too.
    const backslash = '/\\evil.example/state';
    const outside = (path: string) => `request path ${JSON.stringify(path)} is not an absolute path on the Sandbox entrypoint, such as "/health"`;
    expect(
      diagnostics(
        'When the client sends GET "//evil.example/steal"',
        `Then the state at "${backslash}" as "fixture-control" has 0 items at "/orders"`,
        'And the state at "health" as "fixture-control" has 0 items at "/orders"',
      ),
    ).toEqual([
      at(5, 'When the client sends GET "//evil.example/steal"', outside('//evil.example/steal')),
      at(6, `Then the state at "${backslash}" as "fixture-control" has 0 items at "/orders"`, outside(backslash)),
      at(7, 'And the state at "health" as "fixture-control" has 0 items at "/orders"', outside('health')),
    ]);
  });

  it('a JSON Pointer without its leading slash, in state and response claims', () => {
    expect(
      diagnostics(
        'When the client sends GET "/health"',
        `Then ${STATE} has 1 item at "users"`,
        'And the response has "status" equal to:',
        ...doc('"ready"'),
        'And the response has a value at "data/token"',
      ),
    ).toEqual([
      at(6, `Then ${STATE} has 1 item at "users"`, '"users" is not a JSON Pointer (RFC 6901), such as "" or "/subscriptions/0/id"'),
      at(7, 'And the response has "status" equal to:', '"status" is not a JSON Pointer (RFC 6901), such as "" or "/subscriptions/0/id"'),
      at(11, 'And the response has a value at "data/token"', '"data/token" is not a JSON Pointer (RFC 6901), such as "" or "/subscriptions/0/id"'),
    ]);
  });

  it('a barrier deadline of 0 seconds or 24 hours', () => {
    expect(
      diagnostics(
        'When the client sends GET "/health"',
        `Then the flow is sealed within 0 seconds when ${STATE} has 1 item at "/orders"`,
        `And the flow is sealed within 86400 seconds when ${STATE} has 1 item at "/orders"`,
        'And the response status is 200',
      ),
    ).toEqual([
      at(6, `Then the flow is sealed within 0 seconds when ${STATE} has 1 item at "/orders"`, 'barrier deadline of 0 seconds is not between 1 and 3600 seconds'),
      at(7, `And the flow is sealed within 86400 seconds when ${STATE} has 1 item at "/orders"`, 'barrier deadline of 86400 seconds is not between 1 and 3600 seconds'),
    ]);
  });

  it('every Examples row of an Outline, with its values substituted', () => {
    const source = [
      '@system:subscription-system @sandbox:default',
      'Feature: probe',
      '',
      '  Scenario Outline: probe <path>',
      '    When the client sends GET "<path>"',
      '    Then the response status is 200',
      '',
      '    Examples:',
      '      | path           |',
      '      | /health        |',
      '      | //evil.example |',
      '',
    ].join('\n');
    expect(() =>
      planFeature(source, 'features/probe.feature', { catalog: testCatalog, sandboxProfiles: { default: WORKED_EXAMPLE_PROFILE }, library }),
    ).toThrow('features/probe.feature:5:5: step "When the client sends GET "//evil.example"": request path "//evil.example" is not an absolute path');
  });
});
