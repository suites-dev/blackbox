import dockerCompose, { type IDockerComposeOptions } from 'docker-compose';
import type { getContainerRuntimeClient } from 'testcontainers';

import type { ComposeStartRequest } from '../../types.js';
import { snapshotContainerEnvironment } from '../container-environment.js';

type Dockerode = Awaited<
  ReturnType<typeof getContainerRuntimeClient>
>['container']['dockerode'];

interface ComposeCreationPort {
  readonly createMany: (
    services: string[],
    options: IDockerComposeOptions,
  ) => Promise<unknown>;
  readonly down: (options: IDockerComposeOptions) => Promise<unknown>;
}

interface CreatedParticipantContainer {
  readonly id: string;
  readonly service: string;
}

interface ContainerInspectionPort {
  readonly listCreated: (
    projectName: string,
  ) => Promise<readonly CreatedParticipantContainer[]>;
  readonly environment: (
    containerId: string,
  ) => Promise<Readonly<Record<string, string>>>;
}

function composeOptions(
  request: ComposeStartRequest,
  commandOptions: readonly string[],
): IDockerComposeOptions {
  return {
    cwd: request.projectDirectory,
    config: [...request.composeFiles],
    composeOptions: ['--project-name', request.projectName],
    commandOptions: [...commandOptions],
    env: { ...process.env, ...request.environment },
  };
}

async function inspectCreatedEnvironments(input: {
  readonly containers: ContainerInspectionPort;
  readonly projectName: string;
  readonly services: readonly string[];
}): Promise<ReadonlyMap<string, Readonly<Record<string, string>>>> {
  const selected = new Set(input.services);
  const containers = await input.containers.listCreated(input.projectName);
  const entries = await Promise.all(
    containers.flatMap((container) => {
      if (!selected.has(container.service)) {
        return [];
      }
      return [
        input.containers
          .environment(container.id)
          .then((environment) => [container.service, environment] as const),
      ];
    }),
  );
  const environments = new Map(entries);
  for (const service of input.services) {
    if (!environments.has(service)) {
      throw new Error(
        `Compose did not create telemetry participant ${JSON.stringify(service)} for environment inspection`,
      );
    }
  }
  return environments;
}

export async function inspectEffectiveParticipantEnvironmentsWithPorts(input: {
  readonly request: ComposeStartRequest;
  readonly containers: ContainerInspectionPort;
  readonly compose: ComposeCreationPort;
}): Promise<ReadonlyMap<string, Readonly<Record<string, string>>>> {
  if (input.request.telemetry.kind === 'disabled') {
    return new Map();
  }
  const services = input.request.telemetry.participants.map(({ service }) => service);
  if (services.length === 0) {
    return new Map();
  }
  let outcome:
    | {
        readonly kind: 'succeeded';
        readonly value: ReadonlyMap<string, Readonly<Record<string, string>>>;
      }
    | { readonly kind: 'failed'; readonly error: unknown };
  try {
    await input.compose.createMany(services, composeOptions(input.request, ['--build']));
    outcome = {
      kind: 'succeeded',
      value: await inspectCreatedEnvironments({
        containers: input.containers,
        projectName: input.request.projectName,
        services,
      }),
    };
  } catch (error) {
    outcome = { kind: 'failed', error };
  }
  try {
    await input.compose.down(
      composeOptions(input.request, ['--volumes', '--remove-orphans']),
    );
  } catch (cleanupError) {
    if (outcome.kind === 'failed') {
      throw new AggregateError(
        [outcome.error, cleanupError],
        'Participant environment inspection and Compose cleanup both failed',
      );
    }
    throw cleanupError;
  }
  if (outcome.kind === 'failed') {
    throw outcome.error instanceof Error
      ? outcome.error
      : new Error('Participant environment inspection failed', { cause: outcome.error });
  }
  return outcome.value;
}

export function inspectEffectiveParticipantEnvironments(input: {
  readonly request: ComposeStartRequest;
  readonly docker: Dockerode;
}): Promise<ReadonlyMap<string, Readonly<Record<string, string>>>> {
  const containers = {
    async listCreated(projectName) {
      const listed = await input.docker.listContainers({
        all: true,
        filters: { label: [`com.docker.compose.project=${projectName}`] },
      });
      return listed.map((container) => ({
        id: container.Id,
        service: container.Labels['com.docker.compose.service'],
      }));
    },
    async environment(containerId) {
      const inspected = await input.docker.getContainer(containerId).inspect();
      return snapshotContainerEnvironment(inspected);
    },
  } satisfies ContainerInspectionPort;
  return inspectEffectiveParticipantEnvironmentsWithPorts({
    request: input.request,
    containers,
    compose: dockerCompose,
  });
}
