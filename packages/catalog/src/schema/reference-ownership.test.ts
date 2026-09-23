import { expect, it } from 'vitest';

import { CatalogValidationError, validateCatalogDocument } from '../index.js';
import { validCatalogDocument } from '../test-fixtures/catalog-document.js';

it.each(['default', 'participant', 'activation'] as const)(
  'rejects inherited object properties as a catalog %s reference',
  (reference) => {
    const base = validCatalogDocument();
    const orders = base.catalog.entries.orders;
    const document = {
      ...base,
      catalog: {
        ...base.catalog,
        default: reference === 'default' ? 'constructor' : base.catalog.default,
        entries: {
          orders: {
            ...orders,
            entrypoint: {
              ...orders.entrypoint,
              participant: reference === 'participant' ? 'constructor' : 'api',
            },
            participants: {
              ...orders.participants,
              api: {
                ...orders.participants.api,
                activation: reference === 'activation' ? 'constructor' : 'node-runtime',
              },
            },
          },
        },
      },
    };
    expect(() => validateCatalogDocument({ document, sourceName: 'references.yaml' })).toThrow(
      CatalogValidationError,
    );
  },
);
