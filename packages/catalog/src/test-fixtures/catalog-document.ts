import type { BlackboxConfig } from '../model/catalog-types.js';

export function validCatalogDocument(): BlackboxConfig {
  return {
    schemaVersion: 1,
    catalog: {
      default: 'orders',
      entries: {
        orders: {
          kind: 'system',
          acquisition: {
            adapter: 'docker-compose@1',
            files: ['.blackbox/compose/base.yml', '.blackbox/compose/test.yml'],
          },
          isolation: 'per-test',
          groupName: undefined,
          entrypoint: {
            participant: 'api',
            protocol: 'http',
            containerPort: 3000,
            readiness: { path: '/health', timeoutMs: 60000 },
          },
          participants: {
            api: {
              service: 'api',
              role: 'entrypoint',
              runtime: 'node',
              activation: 'node-runtime',
            },
            database: {
              service: 'postgres',
              role: 'dependency',
              runtime: 'infra',
              activation: undefined,
            },
          },
          observation: {
            policyId: 'orders-v1',
            boundaries: [{ id: 'effects.http', kind: 'http', authoritativeFor: ['HTTP effects'] }],
            requiredBoundaries: ['effects.http'],
            terminalObservationWindowMs: 1000,
            redaction: {
              requestBodies: 'not-captured',
              headers: ['authorization'],
              dynamicIdentifiers: 'normalized',
            },
          },
        },
      },
    },
    activations: {
      'node-runtime': {
        ref: '.blackbox/instrumentation/bootstrap.mjs',
        adapter: 'node-factory',
        version: 1,
      },
    },
  };
}
