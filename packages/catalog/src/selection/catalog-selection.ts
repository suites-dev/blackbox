import type { BlackboxConfig, CatalogEntry, CatalogEntrySummary } from '../model/catalog-types.js';

export interface ListCatalogEntriesInput {
  readonly config: BlackboxConfig;
}

export function listCatalogEntries(input: ListCatalogEntriesInput): readonly CatalogEntrySummary[] {
  const { config } = input;
  return Object.entries(config.catalog.entries)
    .map(([id, entry]) => ({ id, kind: entry.kind, isDefault: id === config.catalog.default }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type CatalogEntrySelection =
  | { readonly kind: 'default-entry' }
  | { readonly kind: 'explicit-entry'; readonly entryId: string };

export interface SelectCatalogEntryInput {
  readonly config: BlackboxConfig;
  readonly selection: CatalogEntrySelection;
}

function selectionId(config: BlackboxConfig, selection: CatalogEntrySelection): string {
  switch (selection.kind) {
    case 'default-entry':
      return config.catalog.default;
    case 'explicit-entry':
      return selection.entryId;
  }
}

export function selectCatalogEntry(input: SelectCatalogEntryInput): {
  readonly id: string;
  readonly entry: CatalogEntry;
} {
  const { config, selection } = input;
  const id = selectionId(config, selection);
  if (!Object.hasOwn(config.catalog.entries, id)) {
    throw new Error(`Unknown catalog entry ${JSON.stringify(id)}`);
  }
  return { id, entry: config.catalog.entries[id] };
}
