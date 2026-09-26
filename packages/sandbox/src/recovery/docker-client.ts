import { getContainerRuntimeClient } from 'testcontainers';

import type { ComposeRecoveryClient, RecoveryResource } from './types.js';

type Docker = Awaited<
  ReturnType<typeof getContainerRuntimeClient>
>['container']['dockerode'];

function labels(
  values: Readonly<Record<string, string>> | null | undefined,
): RecoveryResource['labels'] {
  return values === null || values === undefined
    ? { kind: 'unavailable' }
    : { kind: 'available', values: { ...values } };
}

function filter(projectName: string): string {
  return JSON.stringify({ label: [`com.docker.compose.project=${projectName}`] });
}

export function composeRecoveryClient(docker: Docker): ComposeRecoveryClient {
  return {
    listContainers: async ({ projectName }) =>
      (await docker.listContainers({ all: true, filters: filter(projectName) }))
        .map(({ Id }) => Id),
    inspectContainer: async ({ id }) => {
      const inspected = await docker.getContainer(id).inspect();
      return {
        id: inspected.Id,
        running: inspected.State.Running,
        labels: labels(inspected.Config.Labels),
      };
    },
    stopContainer: async ({ id, timeoutSeconds }) => {
      await docker.getContainer(id).stop({ t: timeoutSeconds });
    },
    removeContainer: async ({ id, removeAttachedVolumes }) => {
      await docker.getContainer(id).remove({ force: true, v: removeAttachedVolumes });
    },
    listNetworks: async ({ projectName }) =>
      (await docker.listNetworks({ filters: filter(projectName) })).map(({ Id }) => Id),
    inspectNetwork: async ({ id }) => {
      const inspected = await docker.getNetwork(id).inspect();
      return { id: inspected.Id, labels: labels(inspected.Labels) };
    },
    removeNetwork: async ({ id }) => {
      await docker.getNetwork(id).remove();
    },
    listVolumes: async ({ projectName }) => {
      const result = await docker.listVolumes({ filters: filter(projectName) });
      if (!Array.isArray(result.Volumes)) {
        throw new Error('Docker volume inventory was unavailable during Sandbox recovery');
      }
      return result.Volumes.map(({ Name }) => Name);
    },
    inspectVolume: async ({ id }) => {
      const inspected = await docker.getVolume(id).inspect();
      return { id: inspected.Name, labels: labels(inspected.Labels) };
    },
    removeVolume: async ({ id }) => {
      await docker.getVolume(id).remove();
    },
  };
}

export async function createComposeRecoveryClient(): Promise<ComposeRecoveryClient> {
  const runtime = await getContainerRuntimeClient();
  return composeRecoveryClient(runtime.container.dockerode);
}
