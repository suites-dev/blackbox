import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { listCatalogEntries } from '../selection/catalog-selection.js';
import { loadCatalogFile, parseCatalogYaml } from './catalog-loader.js';

it('loads the current E2E catalog including its YAML anchor and alias', async () => {
  const configFile = fileURLToPath(
    new URL('../../../../e2e/blackbox.config.yaml', import.meta.url),
  );
  const loaded = await loadCatalogFile({ configFile });
  expect(loaded.config.catalog.default).toBe('subscription-system');
  expect(loaded.config.catalog.entries['payment-mock'].observation).toEqual(
    loaded.config.catalog.entries['subscription-system'].observation,
  );
  expect(listCatalogEntries({ config: loaded.config }).map(({ id }) => id)).toEqual([
    'payment-mock',
    'payment-mock-dist',
    'subscription-system',
  ]);
});

it('accepts the positive fixture and rejects schema and semantic fixtures', async () => {
  const fixture = (name: string): string =>
    fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));
  await expect(
    loadCatalogFile({ configFile: fixture('minimal.valid.yaml') }),
  ).resolves.toMatchObject({ config: { catalog: { default: 'api' } } });
  await expect(
    loadCatalogFile({ configFile: fixture('unknown-field.invalid.yaml') }),
  ).rejects.toMatchObject({ sourceName: fixture('unknown-field.invalid.yaml') });
  await expect(
    loadCatalogFile({ configFile: fixture('escaping-path.invalid.yaml') }),
  ).rejects.toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({ instancePath: '/catalog/entries/api/acquisition/files/0' }),
      expect.objectContaining({ instancePath: '/activations/node-runtime/ref' }),
    ]),
  });
});

it('reports malformed YAML with its source name', () => {
  expect(() => parseCatalogYaml({ sourceText: 'catalog: [', sourceName: 'broken.yaml' })).toThrow(
    /broken\.yaml/u,
  );
});

it('rejects YAML whose aliases exceed the bounded expansion limit', () => {
  const aliases = Array.from({ length: 101 }, () => '*value').join(', ');
  const sourceText = `value: &value [x]\nexpanded: [${aliases}]\n`;
  expect(() => parseCatalogYaml({ sourceText, sourceName: 'aliases.yaml' })).toThrow(
    /Excessive alias count/u,
  );
});
