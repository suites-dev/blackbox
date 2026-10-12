import type { CatalogEntryKind } from '@suites/blackbox-catalog';

import type { ClientRegistry } from '../clients/types.js';

export type BlackboxCatalogSelection =
  { readonly kind: 'unselected' } | { readonly kind: CatalogEntryKind; readonly id: string };

export interface BlackboxTestOptions extends Partial<Record<'blackboxClients', ClientRegistry>> {
  /** Catalog entry selected for every test in the current Playwright scope. */
  readonly catalogEntry: BlackboxCatalogSelection;
  /** Compose substitution environment supplied to the selected sandbox. */
  readonly blackboxEnvironment: Readonly<Record<string, string>>;
  /**
   * Copy each finished attempt (sandbox record, telemetry and attempt document) to
   * `.blackbox/experiments/<sandboxId>/` beside the Blackbox configuration, where the
   * next Playwright run does not clear it. Default: false.
   */
  readonly blackboxRetainAttempts: boolean;
}
