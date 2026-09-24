import type {
  Activation,
  BlackboxConfig,
  CatalogEntry,
  CatalogEntryKind,
  ObservationPolicy,
  Participant,
  Readiness,
} from '../model/catalog-types.js';

interface SchemaParticipantFields {
  readonly service: string;
  readonly role: 'entrypoint' | 'application' | 'dependency';
  readonly runtime: string;
}

type SchemaParticipant =
  | (SchemaParticipantFields & { readonly activation: string })
  | SchemaParticipantFields;

interface SchemaCatalogEntryFields {
  readonly kind: CatalogEntryKind;
  readonly acquisition: {
    readonly adapter: 'docker-compose@1';
    readonly files: readonly string[];
  };
  readonly entrypoint: {
    readonly participant: string;
    readonly protocol: string;
    readonly containerPort: number;
    readonly readiness: Readiness;
  };
  readonly participants: Readonly<Record<string, SchemaParticipant>>;
  readonly observation: ObservationPolicy;
}

type SchemaCatalogEntry = SchemaCatalogEntryFields &
  (
    | { readonly isolation: 'per-test' }
    | { readonly isolation: 'per-worker' }
    | { readonly isolation: 'group'; readonly groupName: string }
  );

export interface SchemaBlackboxConfig {
  readonly schemaVersion: 1;
  readonly catalog: {
    readonly default: string;
    readonly entries: Readonly<Record<string, SchemaCatalogEntry>>;
  };
  readonly activations: Readonly<Record<string, Activation>>;
}

function decodeParticipant(participant: SchemaParticipant): Participant {
  return {
    service: participant.service,
    role: participant.role,
    runtime: participant.runtime,
    activation:
      'activation' in participant
        ? { kind: 'configured', activationId: participant.activation }
        : { kind: 'unconfigured' },
  };
}

function decodeIsolation(entry: SchemaCatalogEntry): CatalogEntry['isolation'] {
  switch (entry.isolation) {
    case 'per-test':
      return { kind: 'per-test' };
    case 'per-worker':
      return { kind: 'per-worker' };
    case 'group':
      return { kind: 'group', groupName: entry.groupName };
  }
}

function decodeCatalogEntry(entry: SchemaCatalogEntry): CatalogEntry {
  return {
    kind: entry.kind,
    acquisition: entry.acquisition,
    isolation: decodeIsolation(entry),
    entrypoint: entry.entrypoint,
    participants: Object.fromEntries(
      Object.entries(entry.participants).map(([id, participant]) => [
        id,
        decodeParticipant(participant),
      ]),
    ),
    observation: entry.observation,
  };
}

export function decodeCatalogConfig(config: SchemaBlackboxConfig): BlackboxConfig {
  return {
    schemaVersion: config.schemaVersion,
    catalog: {
      default: config.catalog.default,
      entries: Object.fromEntries(
        Object.entries(config.catalog.entries).map(([id, entry]) => [
          id,
          decodeCatalogEntry(entry),
        ]),
      ),
    },
    activations: config.activations,
  };
}
