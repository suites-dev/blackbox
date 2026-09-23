import { resolve } from 'node:path';

import { loadCatalogFile } from '../loading/catalog-loader.js';
import { listCatalogEntries } from '../selection/catalog-selection.js';
import type {
  CatalogCommandFailure,
  CatalogCommandOperation,
  CatalogListResult,
  CatalogValidateResult,
  RunCatalogCommandInput,
} from './catalog-command-types.js';
import { validateReferencedInputs } from './referenced-inputs.js';
import type { CatalogValidationIssue, LoadedCatalog } from '../model/catalog-types.js';
import { CatalogValidationError } from '../schema/catalog-validation.js';

export type {
  CatalogCommandDiagnostic,
  CatalogCommandExitClass,
  CatalogCommandFailure,
  CatalogCommandFailureClassification,
  CatalogCommandOperation,
  CatalogCommandOperationalFailure,
  CatalogCommandOperationalFailureClassification,
  CatalogCommandUserFailure,
  CatalogCommandUserFailureClassification,
  CatalogListResult,
  CatalogListSuccess,
  CatalogValidateResult,
  CatalogValidateSuccess,
  RunCatalogCommandInput,
} from './catalog-command-types.js';

function canonicalConfigFile(projectDirectory: string): string {
  return resolve(projectDirectory, 'blackbox.config.yaml');
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

function validationFailure(
  operation: CatalogCommandOperation,
  configFile: string,
  error: CatalogValidationError,
): CatalogCommandFailure {
  return {
    kind: 'catalog-command-user-error',
    ok: false,
    operation,
    exitClass: 'user-error',
    classification: 'config-invalid',
    configFile,
    diagnostics: error.issues.map((issue) => ({ ...issue })),
  };
}

function loadingFailure(
  operation: CatalogCommandOperation,
  configFile: string,
  error: unknown,
): CatalogCommandFailure {
  if (error instanceof CatalogValidationError) {
    return validationFailure(operation, configFile, error);
  }
  if (errorCode(error) === 'ENOENT') {
    return {
      kind: 'catalog-command-user-error',
      ok: false,
      operation,
      exitClass: 'user-error',
      classification: 'config-missing',
      configFile,
      diagnostics: [
        {
          kind: 'filesystem',
          instancePath: '/',
          message: `Configuration file does not exist: ${configFile}`,
        },
      ],
    };
  }
  return {
    kind: 'catalog-command-operational-error',
    ok: false,
    operation,
    exitClass: 'operational-error',
    classification: 'filesystem-error',
    configFile,
    diagnostics: [
      {
        kind: 'filesystem',
        instancePath: '/',
        message: `Could not read configuration file ${configFile}: ${errorMessage(error)}`,
      },
    ],
  };
}

/**
 * Implements `blackbox catalog validate` for the canonical project-root config.
 * It never writes to stdout/stderr and never terminates the process.
 */
export async function runCatalogValidate(
  input: RunCatalogCommandInput,
): Promise<CatalogValidateResult> {
  const { projectDirectory } = input;
  const configFile = canonicalConfigFile(projectDirectory);
  let loaded: LoadedCatalog;
  try {
    loaded = await loadCatalogFile({ configFile });
  } catch (error) {
    return loadingFailure('catalog.validate', configFile, error);
  }

  let referenceIssues: readonly CatalogValidationIssue[];
  try {
    referenceIssues = await validateReferencedInputs({ catalog: loaded });
  } catch (error) {
    return {
      kind: 'catalog-command-operational-error',
      ok: false,
      operation: 'catalog.validate',
      exitClass: 'operational-error',
      classification: 'filesystem-error',
      configFile,
      diagnostics: [
        {
          kind: 'filesystem',
          instancePath: '/',
          message: `Could not inspect project directory ${loaded.projectDirectory}: ${errorMessage(error)}`,
        },
      ],
    };
  }
  if (referenceIssues.length > 0) {
    return {
      kind: 'catalog-command-user-error',
      ok: false,
      operation: 'catalog.validate',
      exitClass: 'user-error',
      classification: 'referenced-input-invalid',
      configFile,
      diagnostics: referenceIssues.map((issue) => ({ ...issue })),
    };
  }

  return {
    kind: 'catalog-validate-success',
    ok: true,
    operation: 'catalog.validate',
    exitClass: 'success',
    configFile,
    schemaVersion: loaded.config.schemaVersion,
    defaultEntry: loaded.config.catalog.default,
    entryCount: Object.keys(loaded.config.catalog.entries).length,
  };
}

/** Implements the data layer for `blackbox catalog list --json`. */
export async function runCatalogList(input: RunCatalogCommandInput): Promise<CatalogListResult> {
  const { projectDirectory } = input;
  const configFile = canonicalConfigFile(projectDirectory);
  let loaded: LoadedCatalog;
  try {
    loaded = await loadCatalogFile({ configFile });
  } catch (error) {
    return loadingFailure('catalog.list', configFile, error);
  }

  return {
    kind: 'catalog-list-success',
    ok: true,
    operation: 'catalog.list',
    exitClass: 'success',
    configFile,
    defaultEntry: loaded.config.catalog.default,
    entries: listCatalogEntries({ config: loaded.config }),
  };
}
