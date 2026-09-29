import type { CatalogEntry, LoadedCatalog } from '@suites/blackbox-catalog';

const observation = {
  policyId: 'test-policy',
  boundaries: [],
  requiredBoundaries: [],
  terminalObservationWindowMs: 100,
  redaction: {
    requestBodies: 'not-captured',
    headers: [],
    dynamicIdentifiers: 'none',
  },
} as const;

function entry(kind: CatalogEntry['kind'], isolation: CatalogEntry['isolation']): CatalogEntry {
  return {
    kind,
    acquisition: { adapter: 'docker-compose@1', files: ['compose.yaml'] },
    isolation,
    entrypoint: {
      participant: 'api',
      protocol: 'http',
      containerPort: 3000,
      readiness: { path: '/health', timeoutMs: 1_000 },
    },
    participants: {
      api: {
        service: 'api',
        role: 'entrypoint',
        runtime: 'node',
        activation: { kind: 'unconfigured' },
      },
    },
    drivers: {},
    observation,
  };
}

export function catalog(
  kind: CatalogEntry['kind'] = 'system',
  isolation: CatalogEntry['isolation'] = { kind: 'per-test' },
): LoadedCatalog {
  return {
    sourceFile: '/project/blackbox.config.yaml',
    projectDirectory: '/project',
    config: {
      schemaVersion: 1,
      catalog: { default: 'orders', entries: { orders: entry(kind, isolation) } },
      activations: {},
    },
  };
}
