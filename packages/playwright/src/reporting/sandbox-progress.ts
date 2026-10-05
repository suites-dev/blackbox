import type { SandboxProgressEvent } from '@suites/blackbox-sandbox';

import type { AttemptProgress } from './events.js';

/** Project explicitly allowed fields; container inspections include environment secrets. */
export function reportSandboxProgress(
  progress: AttemptProgress,
  event: SandboxProgressEvent,
): void {
  switch (event.kind) {
    case 'acquisition-started':
      progress.emit('sandbox', 'info', event.sandboxId);
      break;
    case 'containers-acquired':
      progress.emit(
        'containers',
        'completed',
        `Testcontainers checks passed: ${event.containers.map(({ service }) => service).join(', ')}`,
      );
      break;
    case 'resources-ready':
      progress.emit(
        'resources',
        'info',
        `${event.resources.containers.length} containers, ${event.resources.networks.length} networks, ${event.resources.volumes.length} volumes`,
      );
      break;
    case 'acquisition-failed':
      progress.emit('acquisition', 'failed', 'resource startup failed; see test error');
      break;
    case 'acquisition-observation': {
      const observation = event.observation;
      if (observation.kind === 'service-state') {
        const container = observation.container;
        const exit =
          container.termination.kind === 'exited' ? `; exit ${container.termination.exitCode}` : '';
        progress.emit(
          'container',
          'info',
          `${container.service}: ${container.state}; Docker health: ${container.health}${exit}`,
        );
      } else if (observation.kind === 'waiting') {
        progress.emit(
          'acquisition',
          'info',
          `waiting for Compose and Testcontainers checks (${Math.floor(observation.elapsedMs / 1000)}s)`,
        );
      } else if (observation.kind === 'observation-status') {
        progress.emit('acquisition', 'info', `Docker progress observation ${observation.status}`);
      }
      break;
    }
  }
}
