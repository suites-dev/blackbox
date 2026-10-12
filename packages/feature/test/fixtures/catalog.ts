import type { FeatureCatalog, FeatureCatalogEntry } from '../../src/index.js';

export const catalog = {
  source: 'blackbox.config.yaml',
  entries: [
    { id: 'escape-tests', kind: 'subsystem' },
    { id: 'orders', kind: 'subsystem' },
    { id: 'subscription-system', kind: 'system' },
  ],
} as const satisfies FeatureCatalog;

/** A minimal blackbox.config.yaml that the catalog package's own loader accepts. */
export function catalogYaml(entries: readonly [FeatureCatalogEntry, ...FeatureCatalogEntry[]]): string {
  const blocks = entries.map(({ id, kind }) => `    ${id}:
      kind: ${kind}
      acquisition:
        adapter: docker-compose@1
        files: [compose.yml]
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness: { path: /health, timeoutMs: 1000 }
      participants:
        api: { service: api, role: entrypoint, runtime: node }
      drivers: {}
      observation:
        policyId: ${id}-v1
        boundaries: [{ id: effects.http, kind: http, authoritativeFor: [HTTP effects] }]
        requiredBoundaries: [effects.http]
        terminalObservationWindowMs: 1000
        redaction: { requestBodies: not-captured, headers: [], dynamicIdentifiers: normalized }
`);
  return `schemaVersion: 1
catalog:
  default: ${entries[0].id}
  entries:
${blocks.join('')}activations: {}
`;
}
