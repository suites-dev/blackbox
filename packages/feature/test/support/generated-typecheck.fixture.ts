import { expect } from 'vitest';
import * as ts from 'typescript';

export function expectValidTypeScript(code: string, fileName: string): void {
  const result = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.Latest },
  });
  expect(result.diagnostics ?? [], fileName).toEqual([]);
}

export function expectGeneratedCodeTypechecks(code: string): void {
  expect(generatedCodeDiagnostics(code)).toEqual([]);
}

export function generatedCodeDiagnostics(code: string): string[] {
  const root = '/__feature_compiler_typecheck__';
  const generatedPath = `${root}/test/generated.ts`;
  const declarationsPath = `${root}/test/playwright.d.ts`;
  const clientsPath = `${root}/clients.d.ts`;
  const virtualFiles = new Map<string, string>([
    [generatedPath, code],
    [
      declarationsPath,
      `
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
        interface NativeTest {
          (title: string, body: (fixtures: Fixtures) => unknown): void;
          (title: string, details: { tag: string[] }, body: (fixtures: Fixtures) => unknown): void;
          use(options: { blackbox: { system: { kind: 'system' | 'subsystem'; id: string }; clients: { api: ApiClient } } }): void;
          describe(title: string, body: () => void): void;
          describe(title: string, details: { tag: string[] }, body: () => void): void;
          beforeEach(title: string, body: (fixtures: Fixtures) => unknown): void;
        }
        export const expect: {
          (actual: unknown): { toBe(expected: unknown): void; toEqual(expected: unknown): void };
          arrayContaining(sample: readonly unknown[]): unknown;
          objectContaining(sample: Record<string, unknown>): unknown;
        };
        export const test: NativeTest;
      }
    `,
    ],
    [
      clientsPath,
      `import type { ApiClient } from '@suites/blackbox-playwright'; export declare const api: ApiClient;`,
    ],
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
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
}
