import { expect } from '@suites/blackbox-playwright';

import { jsonSyntaxError } from '../../syntax/json-syntax.js';
import type { StepArgument, StepFixtures } from '../../runtime/step-types.js';

// Readers for what the compiler hands a step: its expression parameters, its
// fixtures and its doc string or data table. A wrong shape here is a library
// defect, because the expression and the compiler fix it, so it throws.

export type RequestContext = NonNullable<StepFixtures['request']>;
export type Sandbox = NonNullable<StepFixtures['sandbox']>;
export type World = NonNullable<StepFixtures['world']>;

export function stringAt(parameters: readonly unknown[], index: number): string {
  const value = parameters[index];
  if (typeof value !== 'string') {
    throw new TypeError(`Step parameter ${index} is not a string`);
  }
  return value;
}

export function integerAt(parameters: readonly unknown[], index: number): number {
  const value = parameters[index];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`Step parameter ${index} is not an integer`);
  }
  return value;
}

export function fixture<Name extends keyof StepFixtures>(
  fixtures: StepFixtures,
  name: Name,
): NonNullable<StepFixtures[Name]> {
  const value = fixtures[name];
  if (value === undefined) {
    throw new Error(`Step fixture ${name} was not provided; the step must declare it`);
  }
  return value;
}

/** Parses JSON written in a feature or returned by the system, failing the step with `what` when it is not JSON. */
export function parseJson(text: string, what: string): unknown {
  expect(() => {
    JSON.parse(text);
  }, `${what} is JSON`).not.toThrow();
  const value: unknown = JSON.parse(text);
  return value;
}

/** Why `text` is not JSON, or nothing when it is: the compile-time form of parseJson. */
export function jsonProblems(text: string, what: string): readonly string[] {
  const error = jsonSyntaxError(text);
  return error === null ? [] : [`${what} is not JSON (${error})`];
}

/** The compile-time form of jsonDocString: an untyped or `json` doc string holding JSON. */
export function jsonDocStringProblems(argument: StepArgument): readonly string[] {
  if (argument.kind !== 'doc-string') {
    return [];
  }
  const mediaType = argument.mediaType ?? 'json';
  if (mediaType !== 'json') {
    return [
      `the doc string is typed ${JSON.stringify(mediaType)}; this step takes an untyped or json doc string`,
    ];
  }
  return jsonProblems(argument.content, 'the doc string');
}

/** The step's doc string, which must be JSON (untyped or typed `json`). Returns its text. */
export function jsonDocString(argument: StepArgument): string {
  if (argument.kind !== 'doc-string') {
    throw new TypeError('Step expects a doc string');
  }
  expect(argument.mediaType ?? 'json', 'doc string media type').toBe('json');
  parseJson(argument.content, 'the doc string');
  return argument.content;
}

/** The step's data table as records, requiring exactly the given header row. */
export function tableRecords<Column extends string>(
  argument: StepArgument,
  columns: readonly Column[],
): readonly Readonly<Record<Column, string>>[] {
  if (argument.kind !== 'data-table') {
    throw new TypeError('Step expects a data table');
  }
  const [header = [], ...rows] = argument.rows;
  expect(header, 'data table header row').toEqual(columns);
  // Gherkin gives every row as many cells as the header row.
  return rows.map(
    (cells) =>
      Object.fromEntries(columns.map((name, index) => [name, cells[index]])) as Record<
        Column,
        string
      >,
  );
}
