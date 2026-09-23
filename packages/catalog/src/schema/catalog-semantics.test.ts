import { expect, it } from 'vitest';

import { validCatalogDocument } from '../test-fixtures/catalog-document.js';
import { CatalogValidationError, validateCatalogDocument } from './catalog-validation.js';

function issuePaths(document: unknown): readonly string[] {
  try {
    validateCatalogDocument({ document, sourceName: '<test>' });
    return [];
  } catch (error) {
    if (!(error instanceof CatalogValidationError)) {
      throw error;
    }
    return error.issues.map(({ instancePath }) => instancePath);
  }
}

it('rejects blank, NUL, Windows-absolute, and parent-relative paths', () => {
  const base = validCatalogDocument();
  const orders = base.catalog.entries.orders;
  const document = {
    ...base,
    catalog: {
      ...base.catalog,
      entries: {
        orders: {
          ...orders,
          acquisition: {
            ...orders.acquisition,
            files: ['   ', 'bad\0path.yml', 'C:\\outside.yml', '../outside.yml'],
          },
        },
      },
    },
  };
  expect(issuePaths(document)).toEqual([
    '/catalog/entries/orders/acquisition/files/0',
    '/catalog/entries/orders/acquisition/files/1',
    '/catalog/entries/orders/acquisition/files/2',
    '/catalog/entries/orders/acquisition/files/3',
  ]);
});

it('rejects duplicate and missing required observation boundaries', () => {
  const base = validCatalogDocument();
  const orders = base.catalog.entries.orders;
  const boundary = orders.observation.boundaries[0];
  const document = {
    ...base,
    catalog: {
      ...base.catalog,
      entries: {
        orders: {
          ...orders,
          observation: {
            ...orders.observation,
            boundaries: [boundary, boundary],
            requiredBoundaries: ['effects.missing'],
          },
        },
      },
    },
  };
  expect(issuePaths(document)).toEqual([
    '/catalog/entries/orders/observation/boundaries/1/id',
    '/catalog/entries/orders/observation/requiredBoundaries/0',
  ]);
});
