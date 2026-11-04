import { expect, it } from 'vitest';

import { normalizeBlackboxOptions, registeredClients } from './normalization.js';

it('defaults to no system and final capture independently from retention', () => {
  expect(normalizeBlackboxOptions({})).toEqual({
    catalogEntry: { kind: 'unselected' },
    blackboxClients: {}, blackboxEnvironment: {},
    blackboxRetainAttempts: false, blackboxFinalSnapshot: true,
  });
  expect(normalizeBlackboxOptions({ retainAttempts: true, finalSnapshot: false }))
    .toMatchObject({ blackboxRetainAttempts: true, blackboxFinalSnapshot: false });
});

it('leaves string selection kind to Catalog and preserves explicit subsystem validation', () => {
  expect(normalizeBlackboxOptions({ system: 'payment-system' }).catalogEntry)
    .toEqual({ kind: 'catalog-entry', id: 'payment-system' });
  expect(normalizeBlackboxOptions({ system: { kind: 'subsystem', id: 'payments' } }).catalogEntry)
    .toEqual({ kind: 'subsystem', id: 'payments' });
});

it.each([
  null, [], { system: '' }, { system: { kind: 'feature', id: 'x' } },
  { system: { kind: 'system', id: 1 } }, { environment: { TOKEN: 1 } },
  { environment: null }, { clients: null }, { retainAttempts: 'true' }, { finalSnapshot: 0 }, { clients: [] },
  { clients: { database: { target: { participant: 'db', containerPort: 0 } } } },
  { clients: { database: { target: { participant: 'db', containerPort: 5432 }, env: [] } } },
])('rejects invalid runtime configuration independently of TypeScript: %j', (options) => {
  expect(() => normalizeBlackboxOptions(options)).toThrow('Blackbox');
});

it('accepts complete runtime client definitions and reports unregistered handles', () => {
  const definition = {
    target: { participant: 'database', containerPort: 5432 }, env: ['DATABASE_PASSWORD'],
    create: () => Promise.resolve({}), ready: () => undefined, dispose: () => undefined,
  };
  expect(normalizeBlackboxOptions({ clients: { database: definition } }).blackboxClients.database)
    .toBe(definition);
  const handle = {};
  const clients = registeredClients({ database: handle }) as Readonly<Record<string, unknown>>;
  expect(clients.database).toBe(handle);
  expect(() => clients.missing).toThrow('is not registered');
});
