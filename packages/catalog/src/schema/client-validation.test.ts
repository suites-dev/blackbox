import { expect, it } from 'vitest';

import { validCatalogSourceDocument } from '../test-fixtures/catalog-document.js';
import { CatalogValidationError, validateCatalogDocument } from './catalog-validation.js';

function validationPaths(document: unknown): readonly string[] {
  try {
    validateCatalogDocument({ document, sourceName: '<client-test>' });
    return [];
  } catch (error) {
    if (!(error instanceof CatalogValidationError)) {
      throw error;
    }
    return error.issues.map((issue) => issue.instancePath);
  }
}

it.each([
  { ref: '/absolute/client.mjs', target: { kind: 'entrypoint' } },
  { ref: '../outside.mjs', target: { kind: 'entrypoint' } },
])('rejects unsafe client module ref $ref', (client) => {
  const base = validCatalogSourceDocument();
  expect(validationPaths({ ...base, clients: { unsafe: client } })).toEqual([
    '/clients/unsafe/ref',
  ]);
});

it('rejects a participant target that no catalog entry owns', () => {
  const base = validCatalogSourceDocument();
  const client = {
    ref: '.blackbox/clients/missing.mjs',
    target: {
      kind: 'participant' as const,
      participant: 'missing',
      protocol: 'postgresql',
      containerPort: 5432,
    },
  };
  expect(validationPaths({ ...base, clients: { missing: client } })).toEqual([
    '/clients/missing/target/participant',
  ]);
});

it.each([
  { ref: '.blackbox/clients/http.mjs' },
  { ref: '.blackbox/clients/http.mjs', target: { kind: 'unknown' } },
  {
    ref: '.blackbox/clients/postgres.mjs',
    target: { kind: 'participant', participant: 'database', protocol: 'postgresql' },
  },
])('rejects an incomplete client shape %#', (client) => {
  const base = validCatalogSourceDocument();
  expect(validationPaths({ ...base, clients: { invalid: client } })).not.toEqual([]);
});
