import type { CatalogSandboxInput, LoadedCatalog } from '../model/catalog-types.js';
import { selectCatalogEntry, type CatalogEntrySelection } from './catalog-selection.js';
import { resolveDrivers } from './driver-resolution.js';
import { entrypointEndpoint, hostDriverEndpoints } from './endpoint-resolution.js';

export interface ResolveCatalogEntryInput {
  readonly catalog: LoadedCatalog;
  readonly selection: CatalogEntrySelection;
}

function selectedActivations(input: {
  readonly catalog: LoadedCatalog;
  readonly entry: LoadedCatalog['config']['catalog']['entries'][string];
}) {
  const activationIds = new Set(
    Object.values(input.entry.participants).flatMap((participant) =>
      participant.activation.kind === 'configured' ? [participant.activation.activationId] : [],
    ),
  );
  return Object.fromEntries(
    [...activationIds]
      .sort()
      .map((activationId) => [activationId, input.catalog.config.activations[activationId]]),
  );
}

export function resolveCatalogEntry(input: ResolveCatalogEntryInput): CatalogSandboxInput {
  const { catalog, selection } = input;
  const { id, entry } = selectCatalogEntry({ config: catalog.config, selection });
  const endpoint = entrypointEndpoint(entry);
  return {
    catalogEntryId: id,
    projectDirectory: catalog.projectDirectory,
    composeFiles: [...entry.acquisition.files],
    environment: {},
    services: Object.values(entry.participants).map((participant) => participant.service),
    endpoints: [endpoint, ...hostDriverEndpoints(entry)],
    readiness: [
      {
        ...endpoint,
        path: entry.entrypoint.readiness.path,
        timeoutMs: entry.entrypoint.readiness.timeoutMs,
      },
    ],
    drivers: resolveDrivers(entry),
    metadata: {
      kind: entry.kind,
      isolation: entry.isolation,
      participants: { ...entry.participants },
      observation: entry.observation,
      activations: selectedActivations({ catalog, entry }),
    },
  };
}
