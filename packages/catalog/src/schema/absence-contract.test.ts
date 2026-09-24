import { expect, it } from 'vitest';
import { resolveCatalogEntry } from '../selection/sandbox-resolution.js';
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

it.each(['per-test', 'per-worker', 'group'])(
  'retains %s isolation through selection and JSON transport',
  (kind) => {
    const isolation =
      kind === 'group' ? { isolation: kind, groupName: 'checkout-sequence' } : { isolation: kind };
    const config = validateEntry(isolation);
    const input = resolveCatalogEntry({
      catalog: {
        config,
        projectDirectory: '/project',
        sourceFile: '/project/blackbox.config.yaml',
      },
      selection: { kind: 'default-entry' },
    });
    expect(input.metadata.isolation).toStrictEqual(
      kind === 'group' ? { kind, groupName: 'checkout-sequence' } : { kind },
    );
    expect(input.metadata.participants.api.activation).toStrictEqual({
      kind: 'configured',
      activationId: 'node-runtime',
    });
    expect(input.metadata.participants.database.activation).toStrictEqual({ kind: 'unconfigured' });
    expect(JSON.parse(JSON.stringify(input))).toStrictEqual(input);
  },
);

it.each([
  { isolation: 'group' },
  { isolation: 'group', groupName: null },
  { isolation: 'per-test', groupName: 'lost-group' },
  { isolation: 'per-worker', groupName: 'lost-group' },
  { isolation: 'unknown' },
  { isolation: null },
  { isolation: { kind: 'per-test' } },
])('rejects invalid isolation without silently selecting a lifetime: %j', (change) => {
  expect(() => validateEntry(change)).toThrow('Invalid Blackbox catalog');
});

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

it.each(['isolation', 'participants', 'observation', 'entrypoint'])(
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
