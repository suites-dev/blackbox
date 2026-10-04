import type { CapsuleContainerDetails } from '../model/environment.js';
import type { CapsuleProgressEvent } from '../progress/events.js';
import type { CapsuleReportInfrastructureContainer } from './types.js';

/**
 * Containers the capsule started besides its participants, such as Blackbox's
 * own telemetry collector, from the Docker observations in its progress. The
 * last observed state of each container is kept.
 */
export function infrastructureContainers(input: {
  readonly containers: readonly CapsuleContainerDetails[];
  readonly progress: readonly CapsuleProgressEvent[];
}): readonly CapsuleReportInfrastructureContainer[] {
  const participants = new Set(input.containers.map((container) => container.service));
  const observed = new Map<string, CapsuleReportInfrastructureContainer>();
  for (const event of input.progress) {
    if (event.kind !== 'acquisition-observation' || event.observation.kind !== 'service-state') {
      continue;
    }
    const { container } = event.observation;
    if (!participants.has(container.service)) {
      observed.set(container.containerId, {
        service: container.service,
        containerName: container.containerName,
        containerId: container.containerId,
        state: container.state,
      });
    }
  }
  return [...observed.values()];
}
