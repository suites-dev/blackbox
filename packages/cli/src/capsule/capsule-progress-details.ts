import type {
  CapsuleAcquisitionObservation,
  CapsuleProgressEvent,
} from '@suites/blackbox-capsule-internal';

export function observationDetail(observation: CapsuleAcquisitionObservation): string {
  switch (observation.kind) {
    case 'service-state': {
      const container = observation.container;
      const health =
        container.health === 'not-configured' ? '' : `; Docker health: ${container.health}`;
      const exit =
        container.termination.kind === 'exited' ? `; exit ${container.termination.exitCode}` : '';
      return `${observation.participant}: container ${container.state}${health}${exit}`;
    }
    case 'resource-discovered':
      return `${observation.resource.kind} available: ${observation.resource.name}`;
    case 'waiting':
      return `waiting for Compose startup and Testcontainers checks (${Math.floor(observation.elapsedMs / 1000)}s elapsed)`;
    case 'observation-status':
      return observation.status === 'available'
        ? 'Docker progress observation resumed'
        : 'Docker progress unavailable; startup continues';
  }
}

export function progressDetail(event: CapsuleProgressEvent): string {
  switch (event.kind) {
    case 'session-admitted':
      return `session ${event.sessionId} admitted for ${event.system} (env keys: ${event.environmentKeys.join(', ') || 'none'})`;
    case 'manager-spawned':
      return `manager spawned (pid ${event.managerPid})`;
    case 'manager-ready':
      return `manager ready (pid ${event.managerPid})`;
    case 'catalog-selected':
      return `catalog selected: ${event.system}`;
    case 'catalog-resolved':
      return `catalog resolved: ${event.services.join(', ')}`;
    case 'compose-configured':
      return `Compose configured: ${event.projectName}`;
    case 'acquisition-started':
      return 'acquisition started: starting resources';
    case 'acquisition-observation':
      return observationDetail(event.observation);
    case 'container-acquired':
      return `container ${event.participant}: Testcontainers checks passed (${event.containerName}, ${event.containerId})`;
    case 'endpoint-mapped':
      return `endpoint mapped: ${event.endpoint.url}`;
    case 'resource-owned':
      return `${event.resource.kind} owned: ${event.resource.name}`;
    case 'readiness-started':
      return `application readiness checking: ${event.url}`;
    case 'readiness-succeeded':
      return `application ready: ${event.url} (${event.durationMs}ms)`;
    case 'capsule-ready':
      return `Capsule ready (${event.durationMs}ms)`;
    case 'capsule-start-failed':
      return `start failed at ${event.stage}: ${event.cause.name}: ${event.cause.message}`;
  }
}
