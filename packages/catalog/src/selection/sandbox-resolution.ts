import type { CatalogSandboxInput, LoadedCatalog } from '../model/catalog-types.js';
import { selectCatalogEntry, type CatalogEntrySelection } from './catalog-selection.js';

export interface ResolveCatalogEntryInput {
  readonly catalog: LoadedCatalog;
  readonly selection: CatalogEntrySelection;
}

export function resolveCatalogEntry(input: ResolveCatalogEntryInput): CatalogSandboxInput {
  const { catalog, selection } = input;
  const { id, entry } = selectCatalogEntry({ config: catalog.config, selection });
  const entrypointParticipant = entry.participants[entry.entrypoint.participant];
  const endpoint = {
    name: 'entrypoint',
    service: entrypointParticipant.service,
    containerPort: entry.entrypoint.containerPort,
    protocol: entry.entrypoint.protocol,
  };
  const activationIds = new Set(
    Object.values(entry.participants).flatMap((participant) =>
      participant.activation.kind === 'configured' ? [participant.activation.activationId] : [],
    ),
  );
  const activations = Object.fromEntries(
    [...activationIds]
      .sort()
      .map((activationId) => [activationId, catalog.config.activations[activationId]]),
  );

  return {
    catalogEntryId: id,
    projectDirectory: catalog.projectDirectory,
    composeFiles: [...entry.acquisition.files],
    environment: {},
    services: Object.values(entry.participants).map((participant) => participant.service),
    endpoints: [endpoint],
    readiness: [
      {
        ...endpoint,
        path: entry.entrypoint.readiness.path,
        timeoutMs: entry.entrypoint.readiness.timeoutMs,
      },
    ],
    metadata: {
      kind: entry.kind,
      isolation: entry.isolation,
      participants: { ...entry.participants },
      observation: entry.observation,
      activations,
    },
  };
}
