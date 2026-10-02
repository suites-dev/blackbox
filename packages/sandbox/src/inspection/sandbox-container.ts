export interface SandboxMappedPortSelector {
  readonly containerPort: number;
}

export interface SandboxContainer {
  readonly service: string;
  readonly testcontainer: SandboxTestcontainerInspection;
}

export interface SandboxTestcontainerInspection {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly labels: Readonly<Record<string, string>>;
  /** Effective environment reported by Docker for this exact owned container. */
  readonly environment: Readonly<Record<string, string>>;
  readonly networkNames: readonly string[];
  /** Ports explicitly requested by the caller, keyed by container port. */
  readonly mappedPorts: ReadonlyMap<number, number>;
  getMappedPort(input: SandboxMappedPortSelector): number;
}
