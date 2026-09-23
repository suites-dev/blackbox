import { join } from 'node:path';
import type { LoadedCatalog } from '@suites/blackbox-catalog-internal';

export function catalogFixture(directory: string): LoadedCatalog {
  return {
    sourceFile: join(directory, 'blackbox.config.yaml'), projectDirectory: directory,
    config: {
      schemaVersion: 1, activations: {},
      catalog: { default: 'orders', entries: { orders: {
        kind: 'system', acquisition: { adapter: 'docker-compose@1', files: ['compose.yaml'] },
        isolation: 'per-test', groupName: undefined,
        entrypoint: { participant: 'api', protocol: 'http', containerPort: 3000, readiness: { path: '/health', timeoutMs: 50 } },
        participants: { api: { service: 'api', role: 'entrypoint', runtime: 'infra', activation: undefined } },
        observation: { policyId: 'test', boundaries: [], requiredBoundaries: [], terminalObservationWindowMs: 0,
          redaction: { requestBodies: 'not-captured', headers: [], dynamicIdentifiers: 'none' } },
      } } },
    },
  };
}

