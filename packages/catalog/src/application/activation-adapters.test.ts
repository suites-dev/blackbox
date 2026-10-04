import { expect, it } from 'vitest';

import type { BlackboxConfig } from '../model/catalog-types.js';
import { validCatalogDocument } from '../test-fixtures/catalog-document.js';
import {
  registeredActivationAdapters,
  unavailableActivationAdapterIssues,
} from './activation-adapters.js';

function withApiRuntime(runtime: string): BlackboxConfig {
  const config = validCatalogDocument();
  const { orders } = config.catalog.entries;
  return {
    ...config,
    catalog: {
      ...config.catalog,
      entries: {
        orders: {
          ...orders,
          participants: { ...orders.participants, api: { ...orders.participants.api, runtime } },
        },
      },
    },
  };
}

it('accepts an activation an installed adapter serves for the participant runtime', () => {
  expect(
    unavailableActivationAdapterIssues({
      config: validCatalogDocument(),
      adapters: [
        { runtime: 'java', adapter: 'node-factory' },
        { runtime: 'node', adapter: 'node-factory' },
      ],
    }),
  ).toEqual([]);
});

it('matches the adapter and the runtime together, with capsule up wording', () => {
  expect(
    unavailableActivationAdapterIssues({
      config: withApiRuntime('java'),
      adapters: [
        { runtime: 'node', adapter: 'node-factory' },
        { runtime: 'java', adapter: 'java-agent' },
      ],
    }),
  ).toEqual([
    {
      kind: 'semantic',
      instancePath: '/catalog/entries/orders/participants/api/activation',
      message: 'Activation adapter "node-factory" for runtime "java" is unavailable',
    },
  ]);
});

it('refuses every configured activation, and only those, when no adapter is installed', () => {
  expect(
    unavailableActivationAdapterIssues({ config: validCatalogDocument(), adapters: [] }),
  ).toEqual([
    {
      kind: 'semantic',
      instancePath: '/catalog/entries/orders/participants/api/activation',
      message: 'Activation adapter "node-factory" for runtime "node" is unavailable',
    },
  ]);
});

it('checks registered adapters, and skips the check when no runtime plugin registered any', () => {
  const adapters = [{ runtime: 'node', adapter: 'node-preload' }];
  expect(registeredActivationAdapters(adapters)).toEqual({ kind: 'installed', adapters });
  expect(registeredActivationAdapters([])).toEqual({ kind: 'not-checked' });
});
