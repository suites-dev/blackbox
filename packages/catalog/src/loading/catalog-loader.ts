import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { LineCounter, parseDocument } from 'yaml';

import type {
  BlackboxConfig,
  CatalogValidationIssue,
  LoadedCatalog,
} from '../model/catalog-types.js';
import { CatalogValidationError, validateCatalogDocument } from '../schema/catalog-validation.js';

function yamlIssues(source: string, errors: readonly unknown[]): CatalogValidationIssue[] {
  return errors.map((error) => {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'yaml', instancePath: '/', message: `${source}: ${message}` };
  });
}

export interface ParseCatalogYamlInput {
  readonly sourceText: string;
  readonly sourceName: string;
}

export function parseCatalogYaml(input: ParseCatalogYamlInput): BlackboxConfig {
  const { sourceText, sourceName } = input;
  const lineCounter = new LineCounter();
  const document = parseDocument(sourceText, {
    lineCounter,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new CatalogValidationError({
      sourceName,
      issues: yamlIssues(sourceName, document.errors),
    });
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new CatalogValidationError({ sourceName, issues: yamlIssues(sourceName, [error]) });
  }
  return validateCatalogDocument({ document: value, sourceName });
}

export interface LoadCatalogFileInput {
  readonly configFile: string;
}

export async function loadCatalogFile(input: LoadCatalogFileInput): Promise<LoadedCatalog> {
  const { configFile } = input;
  const sourceFile = resolve(configFile);
  const sourceText = await readFile(sourceFile, 'utf8');
  return {
    sourceFile,
    projectDirectory: dirname(sourceFile),
    config: parseCatalogYaml({ sourceText, sourceName: sourceFile }),
  };
}
