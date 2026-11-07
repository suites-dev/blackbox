import type { CatalogEntryKind } from '@suites/blackbox-catalog';

import type { ClientRegistry } from '../clients/types.js';

export type BlackboxSystemSelection = string | {
  readonly kind: CatalogEntryKind;
  readonly id: string;
};

/** Native Playwright option: a narrower test.use() replaces this whole object. */
export type BlackboxOptions = Partial<{
  readonly system: BlackboxSystemSelection;
  readonly clients: ClientRegistry;
  readonly environment: Readonly<Record<string, string>>;
  readonly retainAttempts: boolean;
  readonly finalSnapshot: boolean;
}>;

export interface BlackboxTestOptions {
  readonly blackbox: BlackboxOptions;
}

export type BlackboxCatalogSelection =
  | { readonly kind: 'unselected' }
  | { readonly kind: 'catalog-entry'; readonly id: string }
  | { readonly kind: CatalogEntryKind; readonly id: string };

/** Normalized internal lifecycle input, separate from the public option fixture. */
export interface BlackboxAttemptOptions {
  readonly catalogEntry: BlackboxCatalogSelection;
  readonly blackboxEnvironment: Readonly<Record<string, string>>;
  readonly blackboxClients: ClientRegistry;
  readonly blackboxRetainAttempts: boolean;
  readonly blackboxFinalSnapshot: boolean;
}
