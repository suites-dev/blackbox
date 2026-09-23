import type { CatalogEntrySummary } from '../model/catalog-types.js';

export type CatalogCommandOperation = 'catalog.validate' | 'catalog.list';
export type CatalogCommandExitClass = 'success' | 'user-error' | 'operational-error';
export type CatalogCommandUserFailureClassification =
  | 'config-missing'
  | 'config-invalid'
  | 'referenced-input-invalid';
export type CatalogCommandOperationalFailureClassification = 'filesystem-error';
export type CatalogCommandFailureClassification =
  | CatalogCommandUserFailureClassification
  | CatalogCommandOperationalFailureClassification;

export interface CatalogCommandDiagnostic {
  readonly kind: 'yaml' | 'schema' | 'semantic' | 'filesystem';
  readonly instancePath: string;
  readonly message: string;
}

interface CatalogCommandSuccess {
  readonly ok: true;
  readonly exitClass: 'success';
  readonly configFile: string;
}

export interface CatalogValidateSuccess extends CatalogCommandSuccess {
  readonly kind: 'catalog-validate-success';
  readonly operation: 'catalog.validate';
  readonly schemaVersion: 1;
  readonly defaultEntry: string;
  readonly entryCount: number;
}

export interface CatalogListSuccess extends CatalogCommandSuccess {
  readonly kind: 'catalog-list-success';
  readonly operation: 'catalog.list';
  readonly defaultEntry: string;
  readonly entries: readonly CatalogEntrySummary[];
}

interface CatalogCommandFailureBase {
  readonly ok: false;
  readonly operation: CatalogCommandOperation;
  readonly configFile: string;
  readonly diagnostics: readonly CatalogCommandDiagnostic[];
}

export interface CatalogCommandUserFailure extends CatalogCommandFailureBase {
  readonly kind: 'catalog-command-user-error';
  readonly exitClass: 'user-error';
  readonly classification: CatalogCommandUserFailureClassification;
}

export interface CatalogCommandOperationalFailure extends CatalogCommandFailureBase {
  readonly kind: 'catalog-command-operational-error';
  readonly exitClass: 'operational-error';
  readonly classification: CatalogCommandOperationalFailureClassification;
}

export type CatalogCommandFailure = CatalogCommandUserFailure | CatalogCommandOperationalFailure;
export type CatalogValidateResult = CatalogValidateSuccess | CatalogCommandFailure;
export type CatalogListResult = CatalogListSuccess | CatalogCommandFailure;

export interface RunCatalogCommandInput {
  readonly projectDirectory: string;
}
