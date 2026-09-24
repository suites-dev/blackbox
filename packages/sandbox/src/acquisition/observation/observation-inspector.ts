import type { getContainerRuntimeClient } from 'testcontainers';
import type { ComposeObservationSnapshot, ComposeServiceObservation } from '../observation.js';

type Docker = Awaited<ReturnType<typeof getContainerRuntimeClient>>['container']['dockerode'];

interface InspectionOptions {
  readonly filters: { readonly label: string[] };
  readonly abortSignal: AbortSignal;
}

type ObservedLabels =
  | { readonly kind: 'available'; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'unavailable' };

type ObservedHealth =
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'reported'; readonly status: string };

interface InspectedContainer {
  readonly id: string;
  readonly name: string;
  readonly labels: ObservedLabels;
  readonly state: {
    readonly status: string;
    readonly health: ObservedHealth;
    readonly exitCode: number;
  };
}

interface ListedContainer {
  readonly id: string;
  readonly labels: ObservedLabels;
}

interface ObservedNetwork {
  readonly name: string;
  readonly labels: ObservedLabels;
}

interface ObservedVolume {
  readonly name: string;
  readonly labels: ObservedLabels;
}

type ObservedVolumes =
  | { readonly kind: 'available'; readonly volumes: readonly ObservedVolume[] }
  | { readonly kind: 'unavailable' };

export interface ComposeObservationClient {
  listContainers(
    options: InspectionOptions & { readonly all: true },
  ): Promise<readonly ListedContainer[]>;
  listNetworks(options: InspectionOptions): Promise<readonly ObservedNetwork[]>;
  listVolumes(options: InspectionOptions): Promise<ObservedVolumes>;
  getContainer(id: string): {
    inspect(options: { readonly abortSignal: AbortSignal }): Promise<InspectedContainer>;
  };
}

function observedLabels(
  labels: Readonly<Record<string, string>> | null | undefined,
): ObservedLabels {
  return labels === null || labels === undefined
    ? { kind: 'unavailable' }
    : { kind: 'available', values: labels };
}

export function composeObservationClient(docker: Docker): ComposeObservationClient {
  return {
    listContainers: async (options) =>
      (await docker.listContainers(options)).map((container) => ({
        id: container.Id,
        labels: observedLabels(container.Labels),
      })),
    listNetworks: async (options) =>
      (await docker.listNetworks(options)).map((network) => ({
        name: network.Name,
        labels: observedLabels(network.Labels),
      })),
    listVolumes: async (options) => {
      const result = await docker.listVolumes(options);
      const rawVolumes: unknown = Reflect.get(result, 'Volumes');
      if (rawVolumes === undefined) {
        return { kind: 'unavailable' };
      }
      if (rawVolumes === null) {
        return { kind: 'available', volumes: [] };
      }
      return {
        kind: 'available',
        volumes: result.Volumes.map((volume) => ({
          name: volume.Name,
          labels: observedLabels(volume.Labels),
        })),
      };
    },
    getContainer: (id) => ({
      inspect: async (options) => {
        const inspected = await docker.getContainer(id).inspect(options);
        return {
          id: inspected.Id,
          name: inspected.Name,
          labels: observedLabels(inspected.Config.Labels),
          state: {
            status: inspected.State.Status,
            health:
              inspected.State.Health === undefined
                ? { kind: 'not-configured' }
                : { kind: 'reported', status: inspected.State.Health.Status },
            exitCode: inspected.State.ExitCode,
          },
        };
      },
    }),
  };
}

const PROJECT = 'com.docker.compose.project';
const SERVICE = 'com.docker.compose.service';

export async function inspectComposeStartup(input: {
  readonly docker: ComposeObservationClient;
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
  if (volumes.kind === 'unavailable') {
    throw new Error('Docker volume inventory was unavailable');
  }
  const owned = listed.filter((item) => hasProject(item.labels, input.projectName));
  const inspected = await Promise.all(
    owned.map((item) => input.docker.getContainer(item.id).inspect({ abortSignal: input.signal })),
  );
  return {
    containers: inspected.flatMap((item) => ownedContainer(item, input.projectName)),
    resources: [
      ...networks.flatMap((network) =>
        hasProject(network.labels, input.projectName)
          ? [{ kind: 'network' as const, name: network.name }]
          : [],
      ),
      ...volumes.volumes.flatMap((volume) =>
        hasProject(volume.labels, input.projectName)
          ? [{ kind: 'volume' as const, name: volume.name }]
          : [],
      ),
    ],
  };
}

function hasProject(labels: ObservedLabels, projectName: string): boolean {
  return labels.kind === 'available' && labels.values[PROJECT] === projectName;
}

function ownedContainer(
  item: InspectedContainer,
  projectName: string,
): readonly ComposeServiceObservation[] {
  if (!hasProject(item.labels, projectName) || item.labels.kind === 'unavailable') {
    return [];
  }
  const service = item.labels.values[SERVICE];
  if (typeof service !== 'string' || service.length === 0) {
    return [];
  }
  return [containerObservation(item, service)];
}

function containerObservation(
  item: InspectedContainer,
  service: string,
): ComposeServiceObservation {
  const state = containerState(item.state.status);
  return {
    service,
    containerId: item.id,
    containerName: item.name.replace(/^\//u, ''),
    state,
    health: containerHealth(item.state.health),
    termination:
      state === 'exited' || state === 'dead'
        ? { kind: 'exited', exitCode: item.state.exitCode }
        : { kind: 'none' },
  };
}

function containerState(state: string): ComposeServiceObservation['state'] {
  switch (state) {
    case 'created':
    case 'running':
    case 'paused':
    case 'restarting':
    case 'removing':
    case 'exited':
    case 'dead':
      return state;
    default:
      return 'unknown';
  }
}

function containerHealth(health: ObservedHealth): ComposeServiceObservation['health'] {
  if (health.kind === 'not-configured') {
    return 'not-configured';
  }
  switch (health.status) {
    case 'starting':
    case 'healthy':
    case 'unhealthy':
      return health.status;
    default:
      return 'unknown';
  }
}
