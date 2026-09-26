import { expect, it } from 'vitest';

import { validCatalogSourceDocument } from '../test-fixtures/catalog-document.js';
import { CatalogValidationError, validateCatalogDocument } from './catalog-validation.js';

function validationPaths(document: unknown): readonly string[] {
  try {
    validateCatalogDocument({ document, sourceName: '<driver-test>' });
    return [];
  } catch (error) {
    if (!(error instanceof CatalogValidationError)) {
      throw error;
    }
    return error.issues.map((issue) => issue.instancePath);
  }
}

function documentWithDriver(driver: unknown) {
  const base = validCatalogSourceDocument();
  return {
    ...base,
    catalog: {
      ...base.catalog,
      entries: {
        orders: { ...base.catalog.entries.orders, drivers: { tested: driver } },
      },
    },
  };
}

it.each(['/absolute/driver.mjs', '../outside.mjs'])(
  'rejects unsafe driver module ref %s',
  (ref) => {
    const base = validCatalogSourceDocument();
    const driver = { ...base.catalog.entries.orders.drivers.http, ref };
    expect(validationPaths(documentWithDriver(driver))).toEqual([
      '/catalog/entries/orders/drivers/tested/ref',
    ]);
  },
);

it.each([
  ['target', { kind: 'participant', participant: 'missing', protocol: 'http', containerPort: 80 }],
  ['execution', { kind: 'participant', participant: 'missing' }],
] as const)('rejects an unowned %s participant', (field, value) => {
  const base = validCatalogSourceDocument();
  const driver = { ...base.catalog.entries.orders.drivers.http, [field]: value };
  expect(validationPaths(documentWithDriver(driver))).toEqual([
    `/catalog/entries/orders/drivers/tested/${field}/participant`,
  ]);
});

it.each([
  { kind: 'project-driver', runtime: 'node', ref: '.blackbox/drivers/http.mjs' },
  {
    kind: 'project-driver',
    runtime: 'ruby',
    ref: '.blackbox/drivers/http.rb',
    target: { kind: 'participant', participant: 'api', protocol: 'http', containerPort: 3000 },
    execution: { kind: 'host' },
    propagation: {
      kind: 'w3c-trace-context-propagation',
      carrier: 'http-headers',
    },
  },
])('rejects an unsupported or incomplete driver shape %#', (driver) => {
  expect(validationPaths(documentWithDriver(driver))).not.toEqual([]);
});
