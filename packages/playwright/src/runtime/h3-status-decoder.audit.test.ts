import { expect, test, vi } from 'vitest';

import { resolveCatalogEntry, type LoadedCatalog } from '@suites/blackbox-catalog';
import type { SandboxHandle } from '@suites/blackbox-sandbox';

import { verifyRequiredActivations } from './activation.js';
import { catalog } from '../testing/catalog-fixture.js';

function statusWithActivation(runtime: string, serviceName: string) {
  return {
    kind: 'collector-status',
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    instrumentation: {
      kind: 'activated',
      activations: [
        {
          kind: 'instrumentation-activation',
          runtime,
          serviceName,
        },
      ],
    },
  };
}

function activationPlan() {
  const base = catalog();
  const entry = base.config.catalog.entries.orders;
  const configuredCatalog = {
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
              ...entry.participants,
              api: {
                ...entry.participants.api,
                activation: { kind: 'configured', activationId: 'node' },
              },
            },
          },
        },
      },
    },
  } satisfies LoadedCatalog;
  return resolveCatalogEntry({
    catalog: configuredCatalog,
    selection: { kind: 'explicit-entry', entryId: 'orders' },
  });
}

function sandbox(): SandboxHandle {
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
    getContainer() {
      throw new Error('unused');
    },
    inspectResources() {
      throw new Error('unused');
    },
    execute() {
      throw new Error('unused');
    },
    startContainerExecution() {
      throw new Error('unused');
    },
    inspectTelemetry() {
      return Promise.resolve(telemetry);
    },
    stop() {
      throw new Error('unused');
    },
  };
}

test.each([
  { description: 'empty collector service names', runtime: 'node', serviceName: '' },
  { description: 'blank collector runtimes', runtime: '   ', serviceName: 'orders-api' },
])('audit H3: playwright rejects $description', async ({ runtime, serviceName }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(statusWithActivation(runtime, serviceName)))),
  );

  await expect(
    verifyRequiredActivations({
      plan: activationPlan(),
      sandbox: sandbox(),
      authorization: {
        kind: 'split-bearer-tokens',
        ingestToken: 'ingest-token',
        controlToken: 'control-token',
      },
      sessionId: 'quiet-river-ada',
      executionId: 'execution-1',
      timeoutMs: 20,
    }),
  ).rejects.toThrow('Collector status contains an invalid instrumentation activation');
});
