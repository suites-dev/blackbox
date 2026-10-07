import { describe, expect, it } from 'vitest';

import type { StepArgument } from '../step-runtime/step-types.js';
import { library } from './index.js';

// Requirement (benchmark finding F3): each step checks the values written in
// a feature, not only its shape, so a mistake fails before any Sandbox
// starts. Each case is one the benchmark accepted (guardrails 7 to 13):
// invalid JSON in a stimulus or claim doc string, a path on another origin, a
// pointer without its leading slash, an HTTP method that cannot send JSON,
// deadlines of 0 seconds and 24 hours, and a text doc string on a JSON step.
// Moved from the Gherkin compiler's tests with the library: the checks are
// called directly instead of through a compiled feature.

const STATE = 'the state at "/fixture/state" as "fixture-control"';
const NONE = { kind: 'none' } as const satisfies StepArgument;

const doc = (content: string, mediaType: string | null = 'json'): StepArgument => ({
  kind: 'doc-string',
  content,
  mediaType,
});
const table = (...rows: readonly (readonly string[])[]): StepArgument => ({
  kind: 'data-table',
  rows,
});

/** What the step's own check reports for the written values; [] when they pass. */
function problems(text: string, argument: StepArgument = NONE): readonly string[] {
  const resolution = library.resolve(text);
  if (resolution.status !== 'resolved') {
    throw new Error(`${text} is ${resolution.status}`);
  }
  const { check } = resolution.definition;
  return check === null ? [] : check({ parameters: resolution.parameters, argument });
}

const outside = (path: string) =>
  `request path ${JSON.stringify(path)} is not an absolute path on the Sandbox entrypoint, such as "/health"`;
const notPointer = (pointer: string) =>
  `${JSON.stringify(pointer)} is not a JSON Pointer (RFC 6901), such as "" or "/subscriptions/0/id"`;

describe('checks of JSON and requests (benchmark F3)', () => {
  it('accepts values at the edge of every check', () => {
    expect(
      problems(
        'the client sends POST "/subscriptions?next=//other" with JSON:',
        doc('{"userId": "alice"}', null),
      ),
    ).toEqual([]);
    expect(
      problems(`the flow is sealed within 1 second when ${STATE} has 0 items at "/orders"`),
    ).toEqual([]);
    expect(
      problems(
        `the flow is sealed within 3600 seconds when ${STATE} has "" equal to:`,
        doc('{"orders": []}'),
      ),
    ).toEqual([]);
    expect(problems('the response has a value at ""')).toEqual([]);
    expect(problems('the response has "/a~1b/~0c" equal to:', doc('null'))).toEqual([]);
  });

  it('invalid JSON in a stimulus or claim doc string', () => {
    expect(
      problems('the client sends POST "/subscriptions" with JSON:', doc('{"userId": "alice"')),
    ).toEqual([expect.stringMatching(/^the doc string is not JSON \(.+\)$/u)]);
    expect(problems('the response JSON equals:', doc('{"status": 0, "data": null'))).toEqual([
      expect.stringMatching(/^the doc string is not JSON \(.+\)$/u),
    ]);
  });

  it('a text doc string on a JSON step', () => {
    expect(
      problems('the client sends POST "/subscriptions" with JSON:', doc('{}', 'text')),
    ).toEqual(['the doc string is typed "text"; this step takes an untyped or json doc string']);
  });

  it('an HTTP method that cannot send JSON', () => {
    expect(problems('the client sends FETCH "/subscriptions" with JSON:', doc('{}'))).toEqual([
      'HTTP method "FETCH" cannot send a JSON request; use POST, PUT, PATCH or DELETE',
    ]);
  });

  it('every request of a concurrent table, and its header row', () => {
    const step = 'the client sends these requests concurrently:';
    const requests = table(
      ['method', 'path', 'json'],
      ['POST', '/subscriptions', '{"userId": "a"}'],
      ['FETCH', '//evil.example', '{"userId": "b"'],
    );
    expect(problems(step, requests)).toEqual([
      'request 2: HTTP method "FETCH" cannot send a JSON request; use POST, PUT, PATCH or DELETE',
      `request 2: ${outside('//evil.example')}`,
      expect.stringMatching(/^request 2: the json cell is not JSON \(.+\)$/u),
    ]);
    expect(problems(step, table(['method', 'url', 'body'], ['POST', '/a', '{}']))).toEqual([
      'the data table header row is | method | url | body |; it must be | method | path | json |',
    ]);
  });
});

describe('checks of paths, pointers and deadlines (benchmark F3)', () => {
  it('a path on another origin, in a stimulus and in a state read', () => {
    // URLs read a backslash as a slash, so this path names the host evil.example too.
    const backslash = '/\\evil.example/state';
    expect(problems('the client sends GET "//evil.example/steal"')).toEqual([
      outside('//evil.example/steal'),
    ]);
    expect(
      problems(`the state at "${backslash}" as "fixture-control" has 0 items at "/orders"`),
    ).toEqual([outside(backslash)]);
    expect(problems('the state at "health" as "fixture-control" has 0 items at "/orders"')).toEqual(
      [outside('health')],
    );
  });

  it('a JSON Pointer without its leading slash, in state and response claims', () => {
    expect(problems(`${STATE} has 1 item at "users"`)).toEqual([notPointer('users')]);
    expect(problems('the response has "status" equal to:', doc('"ready"'))).toEqual([
      notPointer('status'),
    ]);
    expect(problems('the response has a value at "data/token"')).toEqual([
      notPointer('data/token'),
    ]);
  });

  it('a barrier deadline of 0 seconds or 24 hours', () => {
    expect(
      problems(`the flow is sealed within 0 seconds when ${STATE} has 1 item at "/orders"`),
    ).toEqual(['barrier deadline of 0 seconds is not between 1 and 3600 seconds']);
    expect(
      problems(`the flow is sealed within 86400 seconds when ${STATE} has 1 item at "/orders"`),
    ).toEqual(['barrier deadline of 86400 seconds is not between 1 and 3600 seconds']);
  });
});
