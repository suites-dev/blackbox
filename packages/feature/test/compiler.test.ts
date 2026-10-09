import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import asyncRedisProof from './fixtures/async-redis-proof.feature.js';
import escapingAndDuplicateRows from './fixtures/escaping-and-duplicate-rows.feature.js';
import orderPricing from './fixtures/order-pricing.feature.js';
import subscriptionActivationE2E from './fixtures/subscription-activation-e2e.feature.js';
import subscriptionOutlineInterpolation from './fixtures/subscription-outline-interpolation.feature.js';
import { compileFeature } from '../src/index.js';

const clients = { api: { from: '../clients.js', export: 'api' } } as const;

describe('Feature compiler literal safety', () => {
  it('keeps generated literals safe without changing their runtime values', () => {
    const value = '</script> "quoted" \\path\n\u2028\u2029';
    const featureName = 'Escaping </script> "quoted" \\path';
    const source = [
      `Feature: ${featureName}`,
      '  Scenario: Send a literal value',
      '    When client "api" sends POST "/echo" with JSON:',
      '      """json',
      `      ${JSON.stringify({ value })}`,
      '      """',
      '    Then the response status is 200',
    ].join('\n');
    const result = compileFeature({ source, clients });

    expect(result.diagnostics).toEqual([]);
    expectValidTypeScript(result.code, 'safe-literals.generated.ts');
    expect(result.code).not.toContain('</script>');
    expect(result.code).toContain('\\u003C');
    const title = /suite\.describe\(("(?:\\.|[^"\\])*")/u.exec(result.code);
    const body = /data: (\{[^\n]*?\})/u.exec(result.code);
    if (!title || !body) {throw new Error('Generated suite is missing the title or JSON body.');}
    expect(JSON.parse(title[1])).toBe(`Feature: ${featureName}`);
    expect(JSON.parse(body[1])).toEqual({ value });
  });
});

describe('Feature compiler snapshots', () => {
  it('compiles hierarchy, backgrounds, tags, tables, doc strings, and outline rows', () => {
    const result = compileFeature({ source: orderPricing, uri: 'order-pricing.feature', clients });
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/suite\.test\(/gu)).toHaveLength(2);
    expect(result.code).toContain('id: "orders"');
    expect(result.code).toContain('clients.api.');
    expect(result.code).not.toContain('clients.client_api.');
    expect(result.code).toContain('"quantity":0');
    expect(result.code).toContain('"quantity":2');
    expectValidTypeScript(result.code, 'order-pricing.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

  it('compiles the E2E subscription Outline with placeholders embedded in JSON strings', () => {
    let result: ReturnType<typeof compileFeature> | undefined;
    expect(() => {
      result = compileFeature({
        source: subscriptionOutlineInterpolation,
        uri: 'subscription-activation.feature',
        clients,
      });
    }).not.toThrow();
    if (!result) {
      throw new Error('Feature compilation did not return a result.');
    }
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      '"userId":"${JSON.stringify(String(row["userId"])).slice(1, -1)}"',
    );
    expect(result.code).toContain(
      'pm_${JSON.stringify(String(row["userId"])).slice(1, -1)}_unused',
    );
    expect(result.code).toContain(
      '"reg:${JSON.stringify(String(row["userId"])).slice(1, -1)}":"1"',
    );
    expect(result.code).not.toContain('pm_<userId>_unused');
    expect(result.code).not.toContain('reg:<userId>');
    expectValidTypeScript(result.code, 'subscription-outline-interpolation.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

  it('compiles exact-state assertions in the full E2E Feature', () => {
    const result = compileFeature({
      source: subscriptionActivationE2E,
      uri: 'subscription-activation.feature',
      clients,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('expect(await response.json()).toEqual(');
    expect(result.code).toContain('"reg:${JSON.stringify(String(row["userId"])).slice(1, -1)}"');
    expectValidTypeScript(result.code, 'subscription-activation.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

  it('preserves escaping, And/But/* titles, multiple Act/Assert phases, and duplicate row identity', () => {
    const result = compileFeature({
      source: escapingAndDuplicateRows,
      uri: 'escaping-and-duplicate-rows.feature',
      clients,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/suite\.test\(/gu)).toHaveLength(2);
    expect(result.code).toContain('${rowIndex + 1}');
    expect(result.code).not.toContain('__ROW_INDEX__');
    expect(result.code).not.toContain('"value": "<value>"');
    expect(result.code).toContain('Examples 1');
    expect(result.code).toContain('Examples 2');
    expect(result.code).toContain('clients.api.');
    expect(result.code).not.toContain('clients.client_api.');
    expect(result.code).toContain('"same"');
    expectValidTypeScript(result.code, 'escaping-and-duplicate-rows.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

});

describe('Feature compiler diagnostics', () => {
  it('catches a lost response binding in the generated-code typecheck negative control', () => {
    const result = compileFeature({ source: orderPricing, uri: 'order-pricing.feature', clients });
    const wrongResponseBinding = result.code.replace(
      'const response0 = await step(',
      'const lostResponse = await step(',
    );
    expect(wrongResponseBinding).not.toBe(result.code);
    expect(generatedCodeDiagnostics(wrongResponseBinding)).toEqual(
      expect.arrayContaining([expect.stringContaining("Cannot find name 'response0'")]),
    );
  });

  it('rejects the natural-language async Redis feature without emitting a suite', () => {
    const result = compileFeature({
      source: asyncRedisProof,
      uri: 'redis-proof-delivery.feature',
      clients,
    });
    expect(result.code).toBe('');
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['FEATURE_STEP_UNSUPPORTED']),
    );
    expect(result).toMatchSnapshot();
  });

  it('rejects malformed Gherkin, invalid JSON, and unbound clients', () => {
    const malformed = compileFeature({ source: 'not a Gherkin document', clients });
    expect(malformed.code).toBe('');
    expect(malformed.diagnostics.map(({ code }) => code)).toContain('FEATURE_SYNTAX');

    const invalidJson = compileFeature({
      clients,
      source: `Feature: Invalid JSON
  Scenario: broken body
    When client "api" sends POST "/items" with JSON:
      """json
      { not-json }
      """
    Then the response status is 200`,
    });
    expect(invalidJson.code).toBe('');
    expect(invalidJson.diagnostics.map(({ code }) => code)).toContain('FEATURE_JSON_INVALID');

    const unbound = compileFeature({
      clients: {},
      source: `Feature: Unknown client
  Scenario: unknown binding
    When client "api" sends GET "/health"
    Then the response status is 200`,
    });
    expect(unbound.code).toBe('');
    expect(unbound.diagnostics.map(({ code }) => code)).toContain('CLIENT_UNKNOWN');
    expect({ malformed, invalidJson, unbound }).toMatchSnapshot();
  });
});

function expectValidTypeScript(code: string, fileName: string): void {
  const result = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.Latest },
  });
  expect(result.diagnostics ?? [], fileName).toEqual([]);
}

function expectGeneratedCodeTypechecks(code: string): void {
  expect(generatedCodeDiagnostics(code)).toEqual([]);
}

function generatedCodeDiagnostics(code: string): string[] {
  const root = '/__feature_compiler_typecheck__';
  const generatedPath = `${root}/test/generated.ts`;
  const declarationsPath = `${root}/test/playwright.d.ts`;
  const clientsPath = `${root}/clients.d.ts`;
  const virtualFiles = new Map<string, string>([
    [generatedPath, code],
    [declarationsPath, `
      declare module '@suites/blackbox-playwright' {
        export interface ApiResponse { status(): number; json(): Promise<unknown> }
        export interface ApiClient {
          get(path: string): Promise<ApiResponse>;
          post(path: string, options?: { data: unknown }): Promise<ApiResponse>;
          patch(path: string, options?: { data: unknown }): Promise<ApiResponse>;
        }
        interface Fixtures {
          clients: { api: ApiClient };
          step<T>(title: string, body: () => T | Promise<T>): Promise<Awaited<T>>;
        }
        interface Suite {
          describe(title: string, body: () => void): void;
          describe(title: string, details: { tag: string[] }, body: () => void): void;
          beforeEach(title: string, body: (fixtures: Fixtures) => unknown): void;
          test(title: string, body: (fixtures: Fixtures) => unknown): void;
          test(title: string, details: { tag: string[] }, body: (fixtures: Fixtures) => unknown): void;
        }
        interface System { sandbox(name: string, options: { clients: { api: ApiClient } }, body: (suite: Suite) => void): void }
        export const expect: (actual: unknown) => { toBe(expected: unknown): void; toEqual(expected: unknown): void; toMatchObject(expected: unknown): void };
        export const test: { system(selector: { kind: 'system' | 'subsystem'; id: string }, body: (system: System) => void): void };
      }
    `],
    [clientsPath, `import type { ApiClient } from '@suites/blackbox-playwright'; export declare const api: ApiClient;`],
  ]);
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  } satisfies ts.CompilerOptions;
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.directoryExists = (directoryName) =>
    directoryName.startsWith(root) || ts.sys.directoryExists(directoryName);
  host.fileExists = (fileName) => virtualFiles.has(fileName) || originalFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(fileName) ?? originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const contents = virtualFiles.get(fileName);
    if (contents !== undefined) {
      return ts.createSourceFile(fileName, contents, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram([generatedPath, declarationsPath], options, host);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
}
