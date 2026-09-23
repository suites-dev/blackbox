import { expect, it } from 'vitest';

import { listCatalogEntries, resolveCatalogEntry, selectCatalogEntry } from '../index.js';
import { validCatalogDocument } from '../test-fixtures/catalog-document.js';

it('selects the named entry independently of insertion order and the default', () => {
  const base = validCatalogDocument();
  const orders = base.catalog.entries.orders;
  const config = {
    ...base,
    catalog: {
      default: 'zulu',
      entries: { zulu: orders, alpha: { ...orders, kind: 'subsystem' as const } },
    },
  };
  expect(listCatalogEntries({ config })).toEqual([
    { id: 'alpha', kind: 'subsystem', isDefault: false },
    { id: 'zulu', kind: 'system', isDefault: true },
  ]);
  expect(selectCatalogEntry({ config, selection: { kind: 'default-entry' } }).id).toBe('zulu');
  const result = resolveCatalogEntry({
    catalog: { config, sourceFile: '/project/blackbox.config.yaml', projectDirectory: '/project' },
    selection: { kind: 'explicit-entry', entryId: 'alpha' },
  });
  expect(result.catalogEntryId).toBe('alpha');
  expect(result.metadata.kind).toBe('subsystem');
  expect(() =>
    selectCatalogEntry({ config, selection: { kind: 'explicit-entry', entryId: 'constructor' } }),
  ).toThrow('Unknown catalog entry');
});

it('resolves only the selected participants activations and preserves ordered Compose files', () => {
  const base = validCatalogDocument();
  const config = {
    ...base,
    activations: {
      unused: { ...base.activations['node-runtime'], ref: 'unused.mjs' },
      ...base.activations,
    },
  };
  const result = resolveCatalogEntry({
    catalog: { config, sourceFile: '/project/blackbox.config.yaml', projectDirectory: '/project' },
    selection: { kind: 'default-entry' },
  });
  expect(result.metadata.activations).toEqual({
    'node-runtime': base.activations['node-runtime'],
  });
  expect(result.composeFiles).toEqual(['.blackbox/compose/base.yml', '.blackbox/compose/test.yml']);
  expect(result.composeFiles).not.toBe(config.catalog.entries.orders.acquisition.files);
  expect(result.services).toEqual(['api', 'postgres']);
  expect(result.endpoints[0].service).toBe('api');
  expect(result.readiness[0]).toMatchObject({ path: '/health', timeoutMs: 60_000 });
  expect(base.catalog.entries.orders.acquisition.files).toEqual(result.composeFiles);
});
