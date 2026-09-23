import { expect, it } from 'vitest';

import { validCatalogDocument } from '../test-fixtures/catalog-document.js';
import {
  CatalogValidationError,
  validateBundledCatalogSchema,
  validateCatalogDocument,
} from '../index.js';

it('self-validates the bundled Draft 2020-12 schema', () => {
  expect(validateBundledCatalogSchema()).toBe(true);
});

it('reports schema failures with the source name and instance path', () => {
  const base = validCatalogDocument();
  const document = {
    ...base,
    catalog: { ...base.catalog, entries: { orders: { unexpected: true } } },
  };
  expect(() => validateCatalogDocument({ document, sourceName: 'blackbox.config.yaml' })).toThrow(
    /blackbox\.config\.yaml.*\/catalog\/entries\/orders/su,
  );
});

it('rejects unresolved references and project-root escapes', () => {
  const base = validCatalogDocument();
  const orders = base.catalog.entries.orders;
  const document = {
    ...base,
    catalog: {
      default: 'missing',
      entries: {
        orders: {
          ...orders,
          acquisition: { ...orders.acquisition, files: ['../outside.yml', '/absolute.yml'] },
          entrypoint: { ...orders.entrypoint, participant: 'missing' },
          participants: {
            ...orders.participants,
            api: { ...orders.participants.api, activation: 'missing' },
          },
        },
      },
    },
  };
  let caught: unknown;
  try {
    validateCatalogDocument({ document, sourceName: 'invalid.yaml' });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CatalogValidationError);
  if (!(caught instanceof CatalogValidationError)) {
    throw caught;
  }
  expect(caught.issues.map(({ instancePath }) => instancePath)).toEqual(
    expect.arrayContaining([
      '/catalog/default',
      '/catalog/entries/orders/entrypoint/participant',
      '/catalog/entries/orders/acquisition/files/0',
      '/catalog/entries/orders/participants/api/activation',
    ]),
  );
});
