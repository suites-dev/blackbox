export type CatalogEntryKind = 'system' | 'subsystem';
export type CatalogIsolation =
  | { readonly kind: 'per-test' }
  | { readonly kind: 'per-worker' }
  | { readonly kind: 'group'; readonly groupName: string };

export interface BlackboxConfig {
  readonly schemaVersion: 1;
  readonly catalog: {
    readonly default: string;
    readonly entries: Readonly<Record<string, CatalogEntry>>;
  };
  readonly activations: Readonly<Record<string, Activation>>;
  readonly clients: Readonly<Record<string, CatalogClient>>;
}

export interface CatalogClient {
  readonly ref: string;
  readonly target: CatalogClientTarget;
}

export type CatalogClientTarget =
  | { readonly kind: 'entrypoint' }
  | {
      readonly kind: 'participant';
      readonly participant: string;
      readonly protocol: string;
      readonly containerPort: number;
    };

export interface CatalogEntry {
  readonly kind: CatalogEntryKind;
  readonly acquisition: {
    readonly adapter: 'docker-compose@1';
    readonly files: readonly string[];
  };
  readonly isolation: CatalogIsolation;
  readonly entrypoint: {
    readonly participant: string;
    readonly protocol: string;
    readonly containerPort: number;
    readonly readiness: Readiness;
  };
  readonly participants: Readonly<Record<string, Participant>>;
  readonly observation: ObservationPolicy;
}

export interface Readiness {
  readonly path: string;
  readonly timeoutMs: number;
}

export interface Participant {
  readonly service: string;
  readonly role: 'entrypoint' | 'application' | 'dependency';
  readonly runtime: string;
  readonly activation: ParticipantActivation;
}

export type ParticipantActivation =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'configured'; readonly activationId: string };

export interface Activation {
  readonly ref: string;
  readonly adapter: string;
  readonly version: number;
}

export interface ObservationBoundary {
  readonly id: string;
  readonly kind: string;
  readonly authoritativeFor: readonly string[];
}

export interface ObservationPolicy {
  readonly policyId: string;
  readonly boundaries: readonly ObservationBoundary[];
  readonly requiredBoundaries: readonly string[];
  readonly terminalObservationWindowMs: number;
  readonly redaction: {
    readonly requestBodies: string;
    readonly headers: readonly string[];
    readonly dynamicIdentifiers: string;
  };
}

export interface LoadedCatalog {
  readonly sourceFile: string;
  readonly projectDirectory: string;
  readonly config: BlackboxConfig;
}

export interface CatalogEntrySummary {
  readonly id: string;
  readonly kind: CatalogEntryKind;
  readonly isDefault: boolean;
}

/** Structural handoff to the catalog-independent sandbox package. */
export interface CatalogSandboxInput {
  readonly catalogEntryId: string;
  readonly projectDirectory: string;
  readonly composeFiles: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly services: readonly string[];
  readonly endpoints: readonly CatalogEndpointRequest[];
  readonly readiness: readonly CatalogReadinessRequest[];
  readonly clients: Readonly<Record<string, ResolvedCatalogClient>>;
  readonly metadata: {
    readonly kind: CatalogEntryKind;
    readonly isolation: CatalogIsolation;
    readonly participants: Readonly<Record<string, Participant>>;
    readonly observation: ObservationPolicy;
    readonly activations: Readonly<Record<string, Activation>>;
  };
}

export interface ResolvedCatalogClient {
  readonly id: string;
  readonly ref: string;
  readonly target: ResolvedCatalogClientTarget;
}

export type ResolvedCatalogClientTarget =
  | {
      readonly kind: 'entrypoint';
      readonly participantId: string;
      readonly service: string;
      readonly protocol: string;
      readonly containerPort: number;
    }
  | {
      readonly kind: 'participant';
      readonly participantId: string;
      readonly service: string;
      readonly protocol: string;
      readonly containerPort: number;
    };

export interface CatalogEndpointRequest {
  readonly name: string;
  readonly service: string;
  readonly containerPort: number;
  readonly protocol: string;
}

export interface CatalogReadinessRequest extends CatalogEndpointRequest {
  readonly path: string;
  readonly timeoutMs: number;
}

export interface CatalogValidationIssue {
  readonly kind: 'yaml' | 'schema' | 'semantic';
  readonly instancePath: string;
  readonly message: string;
}
