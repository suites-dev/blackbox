import type {
  CatalogClient,
  CatalogEntry,
  CatalogSandboxInput,
  LoadedCatalog,
  ResolvedCatalogClient,
} from '../model/catalog-types.js';
import { selectCatalogEntry, type CatalogEntrySelection } from './catalog-selection.js';

export interface ResolveCatalogEntryInput {
  readonly catalog: LoadedCatalog;
  readonly selection: CatalogEntrySelection;
}

function resolveClient(
  id: string,
  client: CatalogClient,
  entry: CatalogEntry,
): ResolvedCatalogClient | null {
  if (client.target.kind === 'entrypoint') {
    const participantId = entry.entrypoint.participant;
    return {
      id,
      ref: client.ref,
      target: {
        kind: 'entrypoint',
        participantId,
        service: entry.participants[participantId].service,
        protocol: entry.entrypoint.protocol,
        containerPort: entry.entrypoint.containerPort,
      },
    };
  }
  if (!Object.hasOwn(entry.participants, client.target.participant)) {
    return null;
  }
  const participant = entry.participants[client.target.participant];
  return {
    id,
    ref: client.ref,
    target: {
      kind: 'participant',
      participantId: client.target.participant,
      service: participant.service,
      protocol: client.target.protocol,
      containerPort: client.target.containerPort,
    },
  };
}

function resolveClients(
  clients: Readonly<Record<string, CatalogClient>>,
  entry: CatalogEntry,
): Readonly<Record<string, ResolvedCatalogClient>> {
  const resolved = Object.entries(clients)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([id, client]) => {
      const value = resolveClient(id, client, entry);
      return value === null ? [] : [[id, value] as const];
    });
  return Object.fromEntries(resolved);
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
    clients: resolveClients(catalog.config.clients, entry),
    metadata: {
      kind: entry.kind,
      isolation: entry.isolation,
      participants: { ...entry.participants },
      observation: entry.observation,
      activations,
    },
  };
}
