/** Docker observations are facts, not application readiness verdicts. */
export interface ComposeServiceObservation {
  readonly service: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly state:
    | 'created'
    | 'running'
    | 'paused'
    | 'restarting'
    | 'removing'
    | 'exited'
    | 'dead'
    | 'unknown';
  readonly health: 'not-configured' | 'starting' | 'healthy' | 'unhealthy' | 'unknown';
  readonly termination:
    | { readonly kind: 'none' }
    | { readonly kind: 'exited'; readonly exitCode: number };
}

export type ComposeAcquisitionObservation =
  | { readonly kind: 'service-state'; readonly container: ComposeServiceObservation }
  | {
      readonly kind: 'resource-discovered';
      readonly resource: { readonly kind: 'network' | 'volume'; readonly name: string };
    }
  | { readonly kind: 'waiting'; readonly elapsedMs: number }
  | { readonly kind: 'observation-status'; readonly status: 'available' | 'unavailable' };

export type ComposeObservationMode =
  | { readonly kind: 'silent' }
  | { readonly kind: 'events'; readonly emit: (event: ComposeAcquisitionObservation) => void };

export interface ComposeObservationSnapshot {
  readonly containers: readonly ComposeServiceObservation[];
  readonly resources: readonly { readonly kind: 'network' | 'volume'; readonly name: string }[];
}
