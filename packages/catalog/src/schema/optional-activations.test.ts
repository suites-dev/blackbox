import { expect, it } from 'vitest';

import { validCatalogSourceDocument } from '../test-fixtures/catalog-document.js';
import { validateCatalogDocument } from './catalog-validation.js';

/** The source document with no activated participant and no root activations key. */
function withoutActivations() {
  const { activations: _activations, ...base } = validCatalogSourceDocument();
  const { orders } = base.catalog.entries;
  const { activation: _activation, ...api } = orders.participants.api;
  return {
    ...base,
    catalog: {
      ...base.catalog,
      entries: { orders: { ...orders, participants: { ...orders.participants, api } } },
    },
  };
}

it('accepts a catalog without a root activations key and decodes it as no activations', () => {
  const document = withoutActivations();
  expect(document).not.toHaveProperty('activations');

  const config = validateCatalogDocument({ document, sourceName: 'blackbox.config.yaml' });
  expect(config.activations).toEqual({});
  expect(config.catalog.entries.orders.participants.api.activation).toEqual({
    kind: 'unconfigured',
  });
});

it('keeps accepting an empty root activations map', () => {
  const document = { ...withoutActivations(), activations: {} };
  expect(
    validateCatalogDocument({ document, sourceName: 'blackbox.config.yaml' }).activations,
  ).toEqual({});
});

it('still refuses a participant that names an activation when the root key is absent', () => {
  const { activations: _activations, ...document } = validCatalogSourceDocument();
  expect(() => validateCatalogDocument({ document, sourceName: 'blackbox.config.yaml' })).toThrow(
    /\/catalog\/entries\/orders\/participants\/api\/activation: does not name an activation: node-runtime/u,
  );
});
