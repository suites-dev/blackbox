import { getContainerRuntimeClient } from 'testcontainers';
import type {
  ComposeResourceInspectionInput,
  ComposeResourceInspectionResult,
} from '../../inspection/resources.js';
import type { ComposeRemainingContainer } from '../../model/compose.js';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

export async function inspectComposeResources(
  input: ComposeResourceInspectionInput,
): Promise<ComposeResourceInspectionResult> {
  const client = await getContainerRuntimeClient();
  const label = `${COMPOSE_PROJECT_LABEL}=${input.projectName}`;
  const filters = JSON.stringify({ label: [label] });
  const [networks, volumeList] = await Promise.all([
    client.container.dockerode.listNetworks({ filters }),
    client.container.dockerode.listVolumes({ filters }),
  ]);
  return {
    kind: 'owned-compose-resources',
    projectName: input.projectName,
    networks: networks.map((network) => ({
      id: network.Id,
      name: network.Name,
      labels: { ...(network.Labels ?? {}) },
    })),
    volumes: volumeList.Volumes.map((volume) => ({
      name: volume.Name,
      labels: { ...volume.Labels },
    })),
  };
}

type Dockerode = Awaited<ReturnType<typeof getContainerRuntimeClient>>['container']['dockerode'];

/** The project's containers Docker still has, by Compose service, for naming what blocked a cleanup. */
export async function inspectRemainingContainers(input: {
  readonly docker: Dockerode;
  readonly projectName: string;
}): Promise<readonly ComposeRemainingContainer[]> {
  const filters = JSON.stringify({ label: [`${COMPOSE_PROJECT_LABEL}=${input.projectName}`] });
  const containers = await input.docker.listContainers({ all: true, filters });
  return containers.map((container) => ({
    service: container.Labels['com.docker.compose.service'] ?? container.Id,
    state: container.State,
  }));
}
