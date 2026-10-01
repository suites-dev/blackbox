import { expect, it } from 'vitest';
import { validCatalogSourceDocument } from '../test-fixtures/catalog-document.js';
import { validateCatalogDocument } from './catalog-validation.js';

function validateEntry(change: Readonly<Record<string, unknown>>) {
  const source = validCatalogSourceDocument();
  return validateCatalogDocument({
    sourceName: 'contract.json',
    document: {
      ...source,
      catalog: {
        ...source.catalog,
        entries: { orders: { ...source.catalog.entries.orders, ...change } },
      },
    },
  });
}

it.each([{ isolation: 'per-test' }, { groupName: 'checkout-sequence' }])(
  'rejects retired runner-lifetime configuration: %j',
  (change) => {
    expect(() => validateEntry(change)).toThrow('Invalid Blackbox catalog');
  },
);

it.each([
  null,
  '',
  42,
  {},
  { kind: 'unconfigured' },
  { kind: 'configured', activationId: 'node-runtime' },
])('rejects malformed authored activation %j instead of treating it as absent', (activation) => {
  const { participants } = validCatalogSourceDocument().catalog.entries.orders;
  expect(() =>
    validateEntry({ participants: { ...participants, api: { ...participants.api, activation } } }),
  ).toThrow('Invalid Blackbox catalog');
});

it.each(['participants', 'observation', 'entrypoint'])(
  'rejects omitted required entry field %s',
  (field) => {
    const source = validCatalogSourceDocument();
    const entry = Object.fromEntries(
      Object.entries(source.catalog.entries.orders).filter(([name]) => name !== field),
    );
    expect(() =>
      validateCatalogDocument({
        sourceName: 'omitted.json',
        document: { ...source, catalog: { ...source.catalog, entries: { orders: entry } } },
      }),
    ).toThrow('Invalid Blackbox catalog');
  },
);
