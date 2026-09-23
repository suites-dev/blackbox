import type { getContainerRuntimeClient } from 'testcontainers';
import type { ComposeObservationSnapshot, ComposeServiceObservation } from './observation.js';

type Docker = Awaited<ReturnType<typeof getContainerRuntimeClient>>['container']['dockerode'];
const PROJECT = 'com.docker.compose.project';
const SERVICE = 'com.docker.compose.service';
const states = new Set(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']);
const healthStates = new Set(['starting', 'healthy', 'unhealthy']);

export async function inspectComposeStartup(input: {
  readonly docker: Docker;
  readonly projectName: string;
  readonly signal: AbortSignal;
}): Promise<ComposeObservationSnapshot> {
  const filters = { label: [`${PROJECT}=${input.projectName}`] };
  const options = { filters, abortSignal: input.signal };
  const [listed, networks, volumes] = await Promise.all([
    input.docker.listContainers({ ...options, all: true }),
    input.docker.listNetworks(options),
    input.docker.listVolumes(options),
  ]);
  const owned = listed.filter((item) => item.Labels[PROJECT] === input.projectName);
  const inspected = await Promise.all(owned.map((item) =>
    input.docker.getContainer(item.Id).inspect({ abortSignal: input.signal })));
  return {
    containers: inspected
      .filter((item) => item.Config.Labels[PROJECT] === input.projectName && Boolean(item.Config.Labels[SERVICE]))
      .map(containerObservation),
    resources: [
      ...networks.filter((item) => item.Labels !== undefined && item.Labels[PROJECT] === input.projectName)
        .map((item) => ({ kind: 'network' as const, name: item.Name })),
      ...(Array.isArray(volumes.Volumes) ? volumes.Volumes : []).filter((item) => item.Labels[PROJECT] === input.projectName)
        .map((item) => ({ kind: 'volume' as const, name: item.Name })),
    ],
  };
}

function containerObservation(item: Awaited<ReturnType<ReturnType<Docker['getContainer']>['inspect']>>): ComposeServiceObservation {
  const state = item.State.Status;
  const health = item.State.Health;
  return {
    service: item.Config.Labels[SERVICE], containerId: item.Id,
    containerName: item.Name.replace(/^\//u, ''),
    state: states.has(state) ? state as ComposeServiceObservation['state'] : 'unknown',
    health: health === undefined ? 'not-configured'
      : healthStates.has(health.Status) ? health.Status as ComposeServiceObservation['health'] : 'unknown',
    termination: state === 'exited' || state === 'dead'
      ? { kind: 'exited', exitCode: item.State.ExitCode } : { kind: 'none' },
  };
}
