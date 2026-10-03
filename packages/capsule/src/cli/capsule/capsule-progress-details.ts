import type {
  CapsuleAcquisitionObservation,
  CapsuleProgressEvent,
} from '@suites/blackbox-capsule';

import { participantExitText } from '../operations/lifecycle/participant-warnings.js';

/** `ts-travel-service:12346, …`: the published endpoints start-up waits on. */
function awaitingText(
  awaiting: readonly { readonly service: string; readonly containerPort: number }[],
): string {
  return awaiting
    .map(({ service, containerPort }) => `${service}:${String(containerPort)}`)
    .join(', ');
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

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
    case 'waiting-for-endpoints':
      return `waiting for Compose startup and Testcontainers checks: ${awaitingText(observation.awaiting)} accepting connections (${Math.floor(observation.elapsedMs / 1000)}s elapsed)`;
    case 'observation-status':
      return observation.status === 'available'
        ? 'Docker progress observation resumed'
        : 'Docker progress unavailable; startup continues';
  }
}

// eslint-disable-next-line complexity -- one return per CapsuleProgressEvent kind; the exhaustive switch grows only with that event union
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
    case 'acquisition-completed':
      return `Compose start-up finished after ${seconds(event.durationMs)} (start-up budget ${String(event.startupTimeoutMs)}ms; readiness has its own timeout)`;
    case 'readiness-started':
      return `application readiness checking: ${event.url} (timeout ${String(event.timeoutMs)}ms)`;
    case 'readiness-succeeded':
      return `application ready: ${event.url} (${event.durationMs}ms)`;
    case 'capsule-ready':
      return `Capsule ready (${event.durationMs}ms)`;
    case 'capsule-start-failed':
      return `start failed at ${event.stage}: ${event.cause.name}: ${event.cause.message}`;
    case 'participant-exited':
      return participantExitText(event);
  }
}
