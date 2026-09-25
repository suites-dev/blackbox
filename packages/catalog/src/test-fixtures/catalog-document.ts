import type { BlackboxConfig, CatalogDriver } from '../model/catalog-types.js';

function catalogDrivers(): Readonly<Record<string, CatalogDriver>> {
  return {
    http: {
      kind: 'project-driver',
      runtime: 'node',
      ref: '.blackbox/drivers/http.mjs',
      target: {
        kind: 'participant',
        participant: 'api',
        protocol: 'http',
        containerPort: 3000,
      },
      execution: { kind: 'host' },
      propagation: {
        kind: 'w3c-trace-context-propagation',
        carrier: 'http-headers',
      },
    },
    postgres: {
      kind: 'project-driver',
      runtime: 'node',
      ref: '.blackbox/drivers/postgres.mjs',
      target: {
        kind: 'participant',
        participant: 'database',
        protocol: 'postgresql',
        containerPort: 5432,
      },
      execution: { kind: 'participant', participant: 'database' },
      propagation: {
        kind: 'shared-state-propagation-unsupported',
        resource: 'postgresql',
      },
    },
  };
}

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
          isolation: { kind: 'per-test' },
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
              activation: { kind: 'configured', activationId: 'node-runtime' },
            },
            database: {
              service: 'postgres',
              role: 'dependency',
              runtime: 'infra',
              activation: { kind: 'unconfigured' },
            },
          },
          drivers: catalogDrivers(),
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

/** User-authored schema shape before boundary decoding. */
export function validCatalogSourceDocument() {
  return {
    schemaVersion: 1 as const,
    catalog: {
      default: 'orders',
      entries: {
        orders: {
          kind: 'system' as const,
          acquisition: {
            adapter: 'docker-compose@1' as const,
            files: ['.blackbox/compose/base.yml', '.blackbox/compose/test.yml'],
          },
          isolation: 'per-test' as const,
          entrypoint: {
            participant: 'api',
            protocol: 'http',
            containerPort: 3000,
            readiness: { path: '/health', timeoutMs: 60000 },
          },
          participants: {
            api: {
              service: 'api',
              role: 'entrypoint' as const,
              runtime: 'node',
              activation: 'node-runtime',
            },
            database: {
              service: 'postgres',
              role: 'dependency' as const,
              runtime: 'infra',
            },
          },
          drivers: catalogDrivers(),
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
