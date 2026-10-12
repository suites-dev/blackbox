import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compileFeature } from '../src/index.js';
import { catalog } from './fixtures/catalog.js';

const clients = { api: { from: '../clients.js', export: 'api' } } as const;

const validationErrors = {
  statusCode: 400,
  errors: [
    { property: 'name', constraints: { isNotEmpty: 'name should not be empty' } },
    { property: 'type', constraints: { isString: 'type must be a string' } },
    { property: 'imageUrl', constraints: { isUrl: 'imageUrl must be a URL' } },
  ],
};

function containsFeature(expected: string): string {
  return `@subsystem:orders
Feature: contains
  Scenario: compare the response
    When client "api" sends GET "/resource"
    Then the response JSON contains:
      """json
      ${expected}
      """
`;
}

/** Run every generated test against one response body and report which ones passed. */
async function outcomes(source: string, responseJson: unknown): Promise<boolean[]> {
  const result = compileFeature({ catalog, clients, source });
  expect(result.diagnostics).toEqual([]);
  const tests: ((fixtures: unknown) => Promise<void>)[] = [];
  const suite = {
    describe: (...args: unknown[]) => { (args.at(-1) as () => void)(); },
    test: (...args: unknown[]) => tests.push(args.at(-1) as (fixtures: unknown) => Promise<void>),
  };
  const response = { status: () => 200, json: () => Promise.resolve(responseJson) };
  const api = { get: () => Promise.resolve(response) };
  runInNewContext(result.code.replace(/^import .*;$/gmu, ''), {
    client_api: {},
    expect,
    test: { system: (_selector: unknown, callback: (system: unknown) => void) => { callback({
      sandbox: (_name: string, _options: unknown, callback: (value: unknown) => void) => { callback(suite); },
    }); } },
  });
  expect(tests.length).toBeGreaterThan(0);
  const passed: boolean[] = [];
  for (const test of tests) {
    try {
      await test({ clients: { api }, step: (_title: string, operation: () => unknown) => operation() });
      passed.push(true);
    } catch {
      passed.push(false);
    }
  }
  return passed;
}

describe('"contains" is an order-insensitive subset at every level', () => {
  it('passes a one-element array against a response with three', async () => {
    const expected = '{"errors": [{"property": "type"}]}';
    expect(await outcomes(containsFeature(expected), validationErrors)).toEqual([true]);
  });

  it('fails when an expected element is missing', async () => {
    const expected = '{"errors": [{"property": "isFeatured"}]}';
    expect(await outcomes(containsFeature(expected), validationErrors)).toEqual([false]);
  });

  it('passes when the order differs', async () => {
    const expected = '{"errors": [{"property": "imageUrl"}, {"property": "name"}]}';
    expect(await outcomes(containsFeature(expected), validationErrors)).toEqual([true]);
    expect(await outcomes(containsFeature('[3, 1]'), [1, 2, 3])).toEqual([true]);
  });

  it('matches an object inside an array partially, including nested fields', async () => {
    const partial = '{"errors": [{"constraints": {"isUrl": "imageUrl must be a URL"}}]}';
    expect(await outcomes(containsFeature(partial), validationErrors)).toEqual([true]);
    const wrongValue = '{"errors": [{"property": "imageUrl", "constraints": {"isUrl": "other"}}]}';
    expect(await outcomes(containsFeature(wrongValue), validationErrors)).toEqual([false]);
  });

  it('applies the same rule to nested arrays', async () => {
    const actual = { matrix: [[1, 2], [3, 4, 5]] };
    expect(await outcomes(containsFeature('{"matrix": [[5, 3]]}'), actual)).toEqual([true]);
    expect(await outcomes(containsFeature('{"matrix": [[2, 3]]}'), actual)).toEqual([false]);
  });

  it('keeps primitives literal, so a different type or value fails', async () => {
    expect(await outcomes(containsFeature('{"statusCode": "400"}'), validationErrors)).toEqual([false]);
    expect(await outcomes(containsFeature('{"statusCode": 400}'), validationErrors)).toEqual([true]);
  });

  it('builds the same matchers from Scenario Outline rows', async () => {
    const source = `@subsystem:orders
Feature: contains outline
  Scenario Outline: report <property>
    When client "api" sends GET "/resource"
    Then the response JSON contains:
      """json
      {"statusCode": <status>, "errors": [{"property": "<property>", "constraints": {"<rule>": "<property> <message>"}}]}
      """
    Examples:
      | status | property | rule       | message          |
      | 400    | type     | isString   | must be a string |
      | 400    | name     | isNotEmpty | should not be empty |
      | 400    | name     | isString   | must be a string |
      | 422    | type     | isString   | must be a string |
`;
    expect(await outcomes(source, validationErrors)).toEqual([true, true, false, false]);
  });

  it('builds the same matchers from a fields Data Table', async () => {
    const source = `@subsystem:orders
Feature: contains fields
  Scenario: report one error
    When client "api" sends GET "/resource"
    Then the response JSON contains these fields:
      | field  | json                      |
      | errors | [{"property": "imageUrl"}] |
`;
    expect(await outcomes(source, validationErrors)).toEqual([true]);
    expect(await outcomes(source, { ...validationErrors, errors: [] })).toEqual([false]);
  });

  it('keeps "exactly" strict', async () => {
    const source = `@subsystem:orders
Feature: exact
  Scenario: exact array
    Then client "api" GET "/resource" returns 200 with JSON exactly:
      """json
      [1, 2]
      """
`;
    expect(await outcomes(source, [1, 2])).toEqual([true]);
    expect(await outcomes(source, [2, 1])).toEqual([false]);
    expect(await outcomes(source, [1, 2, 3])).toEqual([false]);
  });
});
