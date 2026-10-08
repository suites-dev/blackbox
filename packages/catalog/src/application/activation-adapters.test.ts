import { expect, it } from 'vitest';

import type { BlackboxConfig, LoadedCatalog, Participant } from '../model/catalog-types.js';
import { validCatalogDocument } from '../test-fixtures/catalog-document.js';
import { activationAdapterIssues, isCatalogActivationAdapter } from './activation-adapters.js';

const nodeAdapters = [
  { runtime: 'node', adapter: 'node-preload' },
  { runtime: 'node', adapter: 'node-esm' },
] as const;

function catalogWith(input: { readonly runtime: string; readonly adapter: string }): LoadedCatalog {
  const document = validCatalogDocument();
  const entry = document.catalog.entries.orders;
  const api = { ...entry.participants.api, runtime: input.runtime } satisfies Participant;
  const config = {
    ...document,
    catalog: {
      ...document.catalog,
      entries: { orders: { ...entry, participants: { ...entry.participants, api } } },
    },
    activations: {
      'node-runtime': { ...document.activations['node-runtime'], adapter: input.adapter },
    },
  } satisfies BlackboxConfig;
  return { sourceFile: 'blackbox.config.yaml', projectDirectory: '/project', config };
}

it('accepts an activated participant whose runtime the adapter activates', () => {
  expect(
    activationAdapterIssues({
      catalog: catalogWith({ runtime: 'node', adapter: 'node-esm' }),
      adapters: nodeAdapters,
    }),
  ).toEqual([]);
});

it('refuses a runtime the named adapter does not activate', () => {
  expect(
    activationAdapterIssues({
      catalog: catalogWith({ runtime: 'java', adapter: 'node-preload' }),
      adapters: nodeAdapters,
    }),
  ).toEqual([
    {
      kind: 'semantic',
      instancePath: '/catalog/entries/orders/participants/api/runtime',
      message:
        'runtime "java" cannot use activation "node-runtime": adapter "node-preload" ' +
        'activates runtime "node"',
    },
  ]);
});

it('refuses an adapter that no installed runtime plugin provides', () => {
  const catalog = catalogWith({ runtime: 'java', adapter: 'java-agent' });

  expect(activationAdapterIssues({ catalog, adapters: nodeAdapters })).toEqual([
    {
      kind: 'semantic',
      instancePath: '/catalog/entries/orders/participants/api/activation',
      message:
        'activation "node-runtime" uses adapter "java-agent", which no installed runtime ' +
        'plugin provides; installed adapters: node-preload (node), node-esm (node)',
    },
  ]);
  expect(activationAdapterIssues({ catalog, adapters: [] })).toEqual([
    expect.objectContaining({
      message: expect.stringMatching(/installed adapters: none$/u) as unknown,
    }),
  ]);
});

it('ignores participants without an activation, whatever their runtime', () => {
  // The fixture's `database` participant is `runtime: infra` with no activation.
  expect(
    activationAdapterIssues({
      catalog: catalogWith({ runtime: 'node', adapter: 'node-preload' }),
      adapters: [{ runtime: 'node', adapter: 'node-preload' }],
    }),
  ).toEqual([]);
});

it('reads only registry values that carry a runtime and an adapter name', () => {
  expect(isCatalogActivationAdapter({ kind: 'x', runtime: 'node', adapter: 'node-esm' })).toBe(
    true,
  );
  expect(isCatalogActivationAdapter({ runtime: 'node' })).toBe(false);
  expect(isCatalogActivationAdapter(null)).toBe(false);
});
