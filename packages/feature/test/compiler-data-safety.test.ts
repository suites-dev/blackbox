import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { compileFeature } from '../src/index.js';

const clients = { api: { from: '../clients.js', export: 'api' } } as const;

it('preserves own __proto__ properties in request JSON and all JSON assertions', async () => {
  const json = '{"__proto__":{"role":"reader"},"nested":{"__proto__":{"ok":true}}}';
  const result = compileFeature({ clients, source: `Feature: exact JSON data
  Scenario: request and partial assertions
    When client "api" sends POST "/echo" with JSON:
      """json
      ${json}
      """
    Then the response JSON contains:
      """json
      ${json}
      """
    And the response JSON contains these fields:
      | field     | json                      |
      | __proto__ | {"role":"reader"}         |
      | nested    | {"__proto__":{"ok":true}} |
  Scenario: exact assertion
    Then client "api" GET "/echo" returns 200 with JSON exactly:
      """json
      ${json}
      """
` });
  expect(result.diagnostics).toEqual([]);
  const payload: unknown = JSON.parse(json);
  const execution = await executeSuite(result.code, payload);
  expect(execution.bodies).toHaveLength(1);
  expect(execution.expected).toHaveLength(3);
  for (const value of [...execution.bodies, ...execution.expected]) {
    expect(JSON.stringify(value)).toBe(json);
    expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
    expect(Object.hasOwn((value as { nested: object }).nested, '__proto__')).toBe(true);
    expect((value as { role: unknown }).role).toBeUndefined();
  }
  await expect(executeSuite(result.code, { nested: {} })).rejects.toThrow();
});

it('preserves $$ Examples headers for both JSON values and string interpolation', async () => {
  const result = compileFeature({ clients, source: `Feature: dollar JSON header
  Scenario Outline: send a value
    When client "api" sends POST "/echo" with JSON:
      """json
      {"value": <$$>, "label": "prefix-<$$>"}
      """
    Then the response status is 200
    Examples:
      | $$ |
      | 42 |
` });
  expect(result.diagnostics).toEqual([]);
  const execution = await executeSuite(result.code, {});
  expect(execution.bodies).toEqual([{ value: 42, label: 'prefix-42' }]);
  expect(result.code).not.toContain('row["$"]');
});

it.each([
  'sends POST "/echo" with JSON:',
  'has sent POST "/echo" with JSON and received 200:',
])('rejects a JSON request without its Doc String: %s', (request) => {
  const result = compileFeature({ clients, source: `Feature: missing body
  Scenario: request
    When client "api" ${request}
` });
  expect(result.code).toBe('');
  expect(result.diagnostics).toEqual([{
    code: 'FEATURE_STEP_UNSUPPORTED',
    message: 'JSON request needs a JSON Doc String.',
    line: 3,
    column: 5,
  }]);
  const bodyless = compileFeature({ clients, source: `Feature: optional body
  Scenario: request
    When client "api" sends POST "/echo"
` });
  expect(bodyless.diagnostics).toEqual([]);
  expect(bodyless.code).toContain('clients.api.post("\\u002Fecho")');
});

async function executeSuite(code: string, responseJson: unknown) {
  const bodies: unknown[] = [];
  const expected: unknown[] = [];
  const tests: ((fixtures: unknown) => Promise<void>)[] = [];
  const suite = {
    describe: (...args: unknown[]) => { (args.at(-1) as () => void)(); },
    test: (...args: unknown[]) => tests.push(args.at(-1) as (fixtures: unknown) => Promise<void>),
  };
  const response = { status: () => 200, json: () => Promise.resolve(responseJson) };
  const api = {
    get: () => Promise.resolve(response),
    post: (_path: string, options: { data: unknown }) => {
      bodies.push(options.data);
      return Promise.resolve(response);
    },
  };
  runInNewContext(code.replace(/^import .*;$/gmu, ''), {
    client_api: {},
    test: { system: (_selector: unknown, callback: (system: unknown) => void) => { callback({
      sandbox: (_name: string, _options: unknown, callback: (suite: unknown) => void) => { callback(suite); },
    }); } },
    expect: (actual: unknown) => ({
      toBe: (value: unknown) => { expect(actual).toBe(value); },
      toEqual: (value: unknown) => { expected.push(value); expect(actual).toEqual(value); },
      toMatchObject: (value: object) => { expected.push(value); expect(actual).toMatchObject(value); },
    }),
  });
  expect(tests.length).toBeGreaterThan(0);
  for (const test of tests) {
    await test({ clients: { api }, step: (_title: string, operation: () => unknown) => operation() });
  }
  return { bodies, expected };
}
