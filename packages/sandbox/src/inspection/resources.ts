import type { SandboxContainer } from '../types.js';

export interface SandboxNetworkResource {
  readonly kind: 'network';
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface SandboxVolumeResource {
  readonly kind: 'volume';
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface SandboxResourceInspectionInput {
  readonly kind: 'owned-compose-resources';
}

export interface SandboxResourceInspectionResult {
  readonly kind: 'owned-compose-resources';
  readonly projectName: string;
  readonly containers: readonly SandboxContainer[];
  readonly networks: readonly SandboxNetworkResource[];
  readonly volumes: readonly SandboxVolumeResource[];
}

export interface ComposeNetworkResource {
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ComposeVolumeResource {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ComposeResourceInspectionInput {
  readonly kind: 'owned-compose-resources';
  readonly projectName: string;
}

export interface ComposeResourceInspectionResult {
  readonly kind: 'owned-compose-resources';
  readonly projectName: string;
  readonly networks: readonly ComposeNetworkResource[];
  readonly volumes: readonly ComposeVolumeResource[];
}

export function immutableResources(input: {
  readonly projectName: string;
  readonly containers: ReadonlyMap<string, SandboxContainer>;
  readonly observed: ComposeResourceInspectionResult;
}): SandboxResourceInspectionResult {
  if (input.observed.projectName !== input.projectName) {
    throw new Error(
      `Resource inspection returned project ${input.observed.projectName}, expected ${input.projectName}`,
    );
  }
  return Object.freeze({
    kind: 'owned-compose-resources',
    projectName: input.projectName,
    containers: Object.freeze([...input.containers.values()]),
    networks: Object.freeze(
      input.observed.networks.map((network) =>
        Object.freeze({
          kind: 'network' as const,
          id: network.id,
          name: network.name,
          labels: Object.freeze({ ...network.labels }),
        }),
      ),
    ),
    volumes: Object.freeze(
      input.observed.volumes.map((volume) =>
        Object.freeze({
          kind: 'volume' as const,
          name: volume.name,
          labels: Object.freeze({ ...volume.labels }),
        }),
      ),
    ),
  });
}
