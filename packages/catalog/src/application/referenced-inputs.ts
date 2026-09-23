import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { CatalogValidationIssue, LoadedCatalog } from '../model/catalog-types.js';

interface ReferencedPath {
  readonly relativePath: string;
  readonly instancePath: string;
}

export interface ValidateReferencedInputsInput {
  readonly catalog: LoadedCatalog;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function referencedPaths(catalog: LoadedCatalog): readonly ReferencedPath[] {
  const references: ReferencedPath[] = [];
  const entries = Object.entries(catalog.config.catalog.entries).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [entryId, entry] of entries) {
    for (const [index, composeFile] of entry.acquisition.files.entries()) {
      references.push({
        relativePath: composeFile,
        instancePath: `/catalog/entries/${entryId}/acquisition/files/${index}`,
      });
    }
  }
  const activations = Object.entries(catalog.config.activations).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [activationId, activation] of activations) {
    references.push({
      relativePath: activation.ref,
      instancePath: `/activations/${activationId}/ref`,
    });
  }
  return references;
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

async function inspectReference(
  projectRoot: string,
  reference: ReferencedPath,
): Promise<CatalogValidationIssue | null> {
  const candidate = resolve(projectRoot, reference.relativePath);
  try {
    const [candidateRealPath, candidateStat] = await Promise.all([
      realpath(candidate),
      stat(candidate),
    ]);
    if (!isContained(projectRoot, candidateRealPath)) {
      return {
        kind: 'semantic',
        instancePath: reference.instancePath,
        message: `resolves outside the project directory: ${reference.relativePath}`,
      };
    }
    if (!candidateStat.isFile()) {
      return {
        kind: 'semantic',
        instancePath: reference.instancePath,
        message: `must refer to a file: ${reference.relativePath}`,
      };
    }
    return null;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw new Error(
        `Could not inspect referenced file ${reference.relativePath}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    return {
      kind: 'semantic',
      instancePath: reference.instancePath,
      message: `referenced file does not exist: ${reference.relativePath}`,
    };
  }
}

export async function validateReferencedInputs(
  input: ValidateReferencedInputsInput,
): Promise<readonly CatalogValidationIssue[]> {
  const { catalog } = input;
  const projectRoot = await realpath(catalog.projectDirectory);
  const inspections = await Promise.all(
    referencedPaths(catalog).map(async (reference) => inspectReference(projectRoot, reference)),
  );
  return inspections.filter((issue): issue is CatalogValidationIssue => issue !== null);
}
