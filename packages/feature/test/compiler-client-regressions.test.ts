import { expect, it } from 'vitest';
import * as ts from 'typescript';
import { compileFeature } from '../src/index.js';

const clients = { api: { from: '../clients.js', export: 'api' } } as const;

it('retains the inline received response for the next JSON assertion', () => {
  const result = compileFeature({
    clients,
    source: `Feature: response scope
  Scenario: inline status retains the latest response
    When client "api" sends GET "/first"
    And client "api" sends GET "/second" and received 200
    Then the response JSON contains:
      """json
      {"ok":true}
      """
`,
  });
  const expected = 'expect(await response1.json()).toMatchObject(JSON.parse("{\\"ok\\":true}"))';
  const stale = 'expect(await response0.json()).toMatchObject(JSON.parse("{\\"ok\\":true}"))';
  const targetsLatestResponse = (code: string) => code.includes(expected) && !code.includes(stale);
  expect(result.diagnostics).toEqual([]);
  expect(targetsLatestResponse(result.code)).toBe(true);
  expect(targetsLatestResponse(result.code.replace(expected, stale))).toBe(false);
});

it('interpolates Example headers with hyphens as bracket properties', () => {
  const result = compileFeature({
    clients,
    source: `Feature: unusual example headers
  Scenario Outline: fetch a user
    When client "api" sends GET "/users/<user-id>"
    Then the response status is 200

    Examples:
      | user-id |
      | 42      |
`,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.code).toContain('row["user-id"]');
  expect(result.code).not.toContain('/users/<user-id>');
  const row = 'declare const row: Record<string, string>;';
  expect(semanticDiagnostics(`${row}\nconst path = \`/users/\${row["user-id"]}\`;`)).toEqual([]);
  expect(semanticDiagnostics(`${row}\nconst path = \`/users/\${row.user-id}\`;`)).not.toEqual([]);
});

it('preserves dollar characters in unusual Example headers', () => {
  const result = compileFeature({
    clients,
    source: `Feature: dollar example header
  Scenario Outline: fetch a user
    When client "api" sends GET "/users/<$$>"
    Then the response status is 200

    Examples:
      | $$ |
      | 42 |
`,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.code).toContain('row["$$"]');
  expect(result.code).not.toContain('row["$"]');
});

function semanticDiagnostics(source: string): string[] {
  const path = '/__feature_path_typecheck__.ts';
  const options = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === path
      ? ts.createSourceFile(path, source, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([path], options, host);
  return program.getSemanticDiagnostics().map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
}
