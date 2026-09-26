import { resolveCatalogEntry, type LoadedCatalog } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import { catalogFixture } from '../testing/acquisition.fixture.js';

export function activationPlan(configured: boolean) {
  const base = catalogFixture('/tmp/project');
  const entry = base.config.catalog.entries.orders;
  const activation = configured
    ? { kind: 'configured' as const, activationId: 'node' }
    : { kind: 'unconfigured' as const };
  const catalog = {
    ...base,
    config: {
      ...base.config,
      activations: {
        node: {
          ref: '.blackbox/instrumentation/instrumentation.js',
          adapter: 'node-preload',
          version: 1,
        },
      },
      catalog: {
        ...base.config.catalog,
        entries: {
          orders: {
            ...entry,
            participants: {
              api: { ...entry.participants.api, runtime: 'node', activation },
            },
          },
        },
      },
    },
  } satisfies LoadedCatalog;
  return resolveCatalogEntry({
    catalog,
    selection: { kind: 'explicit-entry', entryId: 'orders' },
  });
}

export function activationSandbox(): SandboxHandle {
  const telemetry = {
    kind: 'available' as const,
    endpoints: {
      baseUrl: 'http://collector.test',
      tracesUrl: 'http://collector.test/v1/traces',
      activationUrl: 'http://collector.test/v1/activation',
      readUrl: 'http://collector.test/status',
    },
  };
  return {
    sandboxId: 'sandbox',
    projectName: 'project',
    state: 'running',
    declaredEnvironment: {},
    endpoints: new Map(),
    containers: new Map(),
    telemetry,
    getContainer: () => {
      throw new Error('unused');
    },
    inspectResources: () => {
      throw new Error('unused');
    },
    execute: () => {
      throw new Error('unused');
    },
    startContainerExecution: () => {
      throw new Error('unused');
    },
    inspectTelemetry: () => Promise.resolve(telemetry),
    stop: () => {
      throw new Error('unused');
    },
  };
}
