export interface CapsuleEntrypoint {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
}

export interface CapsuleContainerDetails {
  readonly participant: string;
  readonly service: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly host: string;
  readonly networkNames: readonly string[];
}

export interface CapsuleReadinessDetails {
  readonly url: string;
  readonly status: 'ready';
  readonly durationMs: number;
}
