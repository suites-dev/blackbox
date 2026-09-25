import { expect, it } from 'vitest';

import { validCatalogSourceDocument } from '../test-fixtures/catalog-document.js';
import {
  resolveCatalogEntry,
  selectCatalogEntry,
  type CatalogSandboxInput,
  validateCatalogDocument,
} from '../index.js';

it('lists deterministically and selects an explicit or default entry', () => {
  const config = validateCatalogDocument({
    document: validCatalogSourceDocument(),
    sourceName: '<test>',
  });
  expect(selectCatalogEntry({ config, selection: { kind: 'default-entry' } }).id).toBe('orders');
  expect(
    selectCatalogEntry({
      config,
      selection: { kind: 'explicit-entry', entryId: 'orders' },
    }).entry.kind,
  ).toBe('system');
  expect(() =>
    selectCatalogEntry({
      config,
      selection: { kind: 'explicit-entry', entryId: 'unknown' },
    }),
  ).toThrow(/Unknown catalog entry/u);
});

it('preserves Compose order in an explicit structural sandbox input', () => {
  const config = validateCatalogDocument({
    document: validCatalogSourceDocument(),
    sourceName: '<test>',
  });
  const input = resolveCatalogEntry({
    catalog: {
      sourceFile: '/project/blackbox.config.yaml',
      projectDirectory: '/project',
      config,
    },
    selection: { kind: 'default-entry' },
  }) satisfies CatalogSandboxInput;
  expect(input).toEqual({
    catalogEntryId: 'orders',
    projectDirectory: '/project',
    composeFiles: ['.blackbox/compose/base.yml', '.blackbox/compose/test.yml'],
    environment: {},
    services: ['api', 'postgres'],
    endpoints: [
      { name: 'entrypoint', service: 'api', containerPort: 3000, protocol: 'http' },
      { name: 'driver-http', service: 'api', containerPort: 3000, protocol: 'http' },
    ],
    readiness: [
      {
        name: 'entrypoint',
        service: 'api',
        containerPort: 3000,
        protocol: 'http',
        path: '/health',
        timeoutMs: 60000,
      },
    ],
    drivers: {
      http: {
        id: 'http',
        kind: 'project-driver',
        runtime: 'node',
        ref: '.blackbox/drivers/http.mjs',
        target: {
          kind: 'participant',
          participantId: 'api',
          service: 'api',
          protocol: 'http',
          containerPort: 3000,
        },
        execution: { kind: 'host' },
        propagation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
      },
      postgres: {
        id: 'postgres',
        kind: 'project-driver',
        runtime: 'node',
        ref: '.blackbox/drivers/postgres.mjs',
        target: {
          kind: 'participant',
          participantId: 'database',
          service: 'postgres',
          protocol: 'postgresql',
          containerPort: 5432,
        },
        execution: {
          kind: 'participant',
          participantId: 'database',
          service: 'postgres',
        },
        propagation: { kind: 'shared-state-propagation-unsupported', resource: 'postgresql' },
      },
    },
    metadata: {
      kind: 'system',
      isolation: { kind: 'per-test' },
      participants: config.catalog.entries.orders.participants,
      observation: config.catalog.entries.orders.observation,
      activations: { 'node-runtime': config.activations['node-runtime'] },
    },
  });
});
