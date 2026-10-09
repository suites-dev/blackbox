import { Args, Command, Flags } from '@oclif/core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { compileFeature, type FeatureClientBinding } from '../compiler.js';

export class FeatureFileDraft extends Command {
  static override description = 'Draft candidate Feature expectations.';
  static override args = { specification: Args.string({ required: true, description: 'Path to the reviewed human specification.' }) };
  static override flags = { output: Flags.string({ required: true, description: 'Path for the candidate Feature file.' }) };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(FeatureFileDraft);
    this.error(`Feature drafting is unavailable: no authoring provider is configured for ${args.specification} -> ${flags.output}.`);
  }
}

export class FeatureStepList extends Command {
  static override description = 'List the supported executable Feature sentences.';

  public run(): Promise<void> {
    this.log([
      'client "<name>" sends GET|POST|PUT|PATCH|DELETE "<path>" [with JSON]: <JSON Doc String>',
      'client "<name>" has sent GET|POST|PUT|PATCH|DELETE "<path>" with JSON and received <status>: <JSON Doc String>',
      'the response status is <status>',
      'the response JSON contains: <JSON Doc String>',
      'the response JSON contains these fields: <Data Table with field and json columns>',
      'client "<name>" GET "<path>" returns <status> with JSON exactly: <JSON Doc String>',
    ].join('\n'));
    return Promise.resolve();
  }
}

export class FeatureSuiteEmit extends Command {
  static override description = 'Generate a native Playwright suite from a Gherkin Feature.';
  static override args = { feature: Args.string({ required: true, description: 'Path to a Gherkin Feature file.' }) };
  static override flags = {
    clients: Flags.string({ required: true, description: 'Path to the TypeScript client registration module.' }),
    output: Flags.string({ required: true, description: 'Path for the generated TypeScript suite.' }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(FeatureSuiteEmit);
    const result = await compileFromFiles(args.feature, flags.clients, flags.output);
    if (result.diagnostics.length) {
      this.error(renderDiagnostics(result.diagnostics));
    }
    try {
      await writeFile(flags.output, result.code, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (isCode(error, 'EEXIST')) {
        this.error(`Refusing to overwrite existing output file: ${flags.output}. Choose another path or remove the file after reviewing it.`);
      }
      throw error;
    }
    this.log(`Generated ${flags.output}`);
  }
}

export class FeatureFileValidate extends Command {
  static override description = 'Validate a Feature against the supported suite compiler.';
  static override args = { feature: Args.string({ required: true, description: 'Path to a Gherkin Feature file.' }) };
  static override flags = { clients: Flags.string({ required: true, description: 'Path to the TypeScript client registration module.' }) };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(FeatureFileValidate);
    const result = await compileFromFiles(args.feature, flags.clients, undefined);
    if (result.diagnostics.length) {
      this.error(renderDiagnostics(result.diagnostics));
    }
    this.log(`Feature is executable: ${args.feature}`);
  }
}

export class FeatureSuiteValidate extends Command {
  static override description = 'Check a generated suite against its Feature source.';
  static override args = { feature: Args.string({ required: true, description: 'Path to a Gherkin Feature file.' }) };
  static override flags = {
    clients: Flags.string({ required: true, description: 'Path to the TypeScript client registration module.' }),
    output: Flags.string({ required: true, description: 'Path to the generated TypeScript suite.' }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(FeatureSuiteValidate);
    const result = await compileFromFiles(args.feature, flags.clients, flags.output);
    if (result.diagnostics.length) {
      this.error(renderDiagnostics(result.diagnostics));
    }
    let actual: string;
    try {
      actual = await readFile(flags.output, 'utf8');
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        this.error(`Generated suite does not exist: ${flags.output}`);
      }
      throw error;
    }
    if (actual !== result.code) {
      this.error(`Generated suite has drifted from ${args.feature}; emit to a new path and review it before replacing ${flags.output}.`);
    }
    this.log(`Generated suite matches ${args.feature}`);
  }
}

export class FeatureRunVerify extends Command {
  static override description = 'Verify a completed Playwright execution against a Feature.';
  static override args = { feature: Args.string({ required: true, description: 'Path to the accepted Gherkin Feature.' }) };
  static override flags = { results: Flags.string({ required: true, description: 'Path to the completed Playwright results JSON.' }) };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(FeatureRunVerify);
    this.error(`Feature run verification is unavailable until the results contract is defined (${args.feature}, ${flags.results}).`);
  }
}

async function compileFromFiles(
  featurePath: string,
  clientsPath: string,
  outputPath: string | undefined,
): Promise<ReturnType<typeof compileFeature>> {
  const featureAbsolute = path.resolve(featurePath);
  const clientsAbsolute = path.resolve(clientsPath);
  const [source, clientSource] = await Promise.all([
    readFile(featureAbsolute, 'utf8'),
    readFile(clientsAbsolute, 'utf8'),
  ]);
  const names = exportedClientNames(clientSource);
  const referencedNames = [...source.matchAll(/client "([\w$-]+)"/gu)].map((match) => match[1]);
  const moduleFrom = outputPath
    ? relativeImport(path.dirname(path.resolve(outputPath)), clientsAbsolute)
    : relativeImport(process.cwd(), clientsAbsolute);
  const clientModule = moduleFrom.replace(/\.(?:tsx?|mts|cts)$/u, (extension) => {
    if (extension === '.mts') {return '.mjs';}
    if (extension === '.cts') {return '.cjs';}
    return '.js';
  });
  const clients: Record<string, FeatureClientBinding> = {};
  for (const name of new Set(referencedNames)) {
    if (!names.has(name)) {
      return {
        code: '',
        diagnostics: [{
          code: 'CLIENT_EXPORT_MISSING',
          message: `Client ${JSON.stringify(name)} is not a directly exported const in ${clientsPath}.`,
          line: 1,
          column: 1,
        }],
      };
    }
    clients[name] = { from: clientModule, export: name };
  }
  return compileFeature({ source, uri: featureAbsolute, clients });
}

function exportedClientNames(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of stripTypeScriptComments(source).matchAll(/^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gmu)) {
    if (match[1]) {names.add(match[1]);}
  }
  return names;
}

function stripTypeScriptComments(source: string): string {
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (character === '"' || character === "'" || character === '`') {
      const end = findStringEnd(source, index, character);
      output += source.slice(index, end + 1);
      index = end;
    } else if (character === '/' && (next === '/' || next === '*')) {
      const end = findCommentEnd(source, index, next);
      output += source.slice(index, end + 1).replace(/[^\n]/gu, '');
      index = end;
    } else {
      output += character;
    }
  }
  return output;
}

function findStringEnd(source: string, start: number, quoteCharacter: string): number {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (escaped) {escaped = false;}
    else if (character === '\\') {escaped = true;}
    else if (character === quoteCharacter) {return index;}
  }
  return source.length - 1;
}

function findCommentEnd(source: string, start: number, kind: string): number {
  if (kind === '/') {
    const newline = source.indexOf('\n', start);
    return newline < 0 ? source.length - 1 : newline;
  }
  const close = source.indexOf('*/', start + 2);
  return close < 0 ? source.length - 1 : close + 1;
}

function relativeImport(fromDirectory: string, filePath: string): string {
  const relative = path.relative(fromDirectory, filePath).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function renderDiagnostics(diagnostics: readonly { readonly code: string; readonly message: string; readonly line: number; readonly column: number }[]): string {
  return diagnostics.map(({ code, message, line, column }) => `${code} (${line}:${column}): ${message}`).join('\n');
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
