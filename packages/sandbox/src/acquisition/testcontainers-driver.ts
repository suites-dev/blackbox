import { DockerComposeEnvironment, getContainerRuntimeClient } from 'testcontainers';
import type {
  ComposeContainer,
  ComposeSandboxDriver,
  ComposeStartRequest,
  StartedComposeSandbox,
} from '../model/compose.js';
import {
  composeObservationClient,
  inspectComposeStartup,
} from './observation/observation-inspector.js';
import { observeComposeStartup } from './observation/startup-observer.js';
import { upUnlessParticipantExits } from './observation/participant-exit.js';
import { inspectComposeResources } from './resources/resource-inspector.js';
import { writeTelemetryComposeOverride } from '../telemetry/compose-override.js';
import { composeTelemetryController } from '../telemetry/compose-controller.js';
import { writeEndpointComposeOverride } from './endpoint-override.js';
import { snapshotContainerEnvironment } from './container-environment.js';
import { inspectEffectiveParticipantEnvironments } from './environment/effective.js';
import { SandboxReadinessWaitStrategy } from './readiness/wait-strategy.js';

type Dockerode = Awaited<
  ReturnType<typeof getContainerRuntimeClient>
>['container']['dockerode'];

async function composeFilesFor(
  request: ComposeStartRequest,
  docker: Dockerode,
): Promise<readonly string[]> {
  const endpointsOverride = await writeEndpointComposeOverride({
    endpoints: request.endpoints,
    directory: request.generatedComposeDirectory,
  });
  if (request.telemetry.kind === 'disabled') {
    return [...request.composeFiles, endpointsOverride];
  }
  const effectiveEnvironments = await inspectEffectiveParticipantEnvironments({
    request,
    docker,
  });
  const override = await writeTelemetryComposeOverride({
    telemetry: request.telemetry,
    directory: request.generatedComposeDirectory,
    effectiveEnvironments,
  });
  return [...request.composeFiles, endpointsOverride, override];
}

function selectedServices(request: ComposeStartRequest): string[] | undefined {
  if (request.serviceSelection.kind !== 'selected') {
    return undefined;
  }
  const services = [...request.serviceSelection.services];
  if (request.telemetry.kind === 'enabled') {
    services.push(request.telemetry.collector.service);
  }
  return services;
}

/** Services whose exit fails startup: the selected participants and the collector. */
function requiredServiceNames(request: ComposeStartRequest): readonly string[] {
  return request.telemetry.kind === 'enabled'
    ? [...selectedServiceNames(request), request.telemetry.collector.service]
    : selectedServiceNames(request);
}

function selectedServiceNames(request: ComposeStartRequest): readonly string[] {
  return request.serviceSelection.kind === 'selected'
    ? request.serviceSelection.services
    : request.serviceSelection.declaredServices;
}

function composeEnvironment(request: ComposeStartRequest): Readonly<Record<string, string>> {
  if (request.telemetry.kind === 'disabled') {
    return request.environment;
  }
  return {
    ...request.environment,
    BLACKBOX_SANDBOX_OTEL_INGEST_TOKEN: request.telemetry.authorization.ingestToken,
    BLACKBOX_SANDBOX_OTEL_CONTROL_TOKEN: request.telemetry.authorization.controlToken,
  };
}

async function inspectSelectedContainers(input: {
  readonly request: ComposeStartRequest;
  readonly started: Awaited<ReturnType<DockerComposeEnvironment['up']>>;
  readonly docker: Awaited<ReturnType<typeof getContainerRuntimeClient>>['container']['dockerode'];
}): Promise<ReadonlyMap<string, ComposeContainer>> {
  const entries = await Promise.all(
    selectedServiceNames(input.request).map(async (service) => {
      const container = input.started.getContainer(`${service}-1`);
      const inspected = await input.docker.getContainer(container.getId()).inspect();
      const value = Object.freeze({
        id: container.getId(),
        name: container.getName(),
        host: container.getHost(),
        labels: Object.freeze({ ...container.getLabels() }),
        environment: snapshotContainerEnvironment(inspected),
        networkNames: Object.freeze([...container.getNetworkNames()]),
        getMappedPort: (selector: { readonly containerPort: number }) =>
          container.getMappedPort(selector.containerPort),
      }) satisfies ComposeContainer;
      return [service, value] as const;
    }),
  );
  return new Map(entries);
}

async function afterStartOrCleanup<T>(input: {
  readonly started: Awaited<ReturnType<DockerComposeEnvironment['up']>>;
  readonly operation: () => Promise<T> | T;
  readonly failureMessage: string;
}): Promise<T> {
  try {
    return await input.operation();
  } catch (error) {
    try {
      await input.started.down({ removeVolumes: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        input.failureMessage,
      );
    }
    throw error;
  }
}

function telemetryController(input: {
  readonly request: ComposeStartRequest;
  readonly started: Awaited<ReturnType<DockerComposeEnvironment['up']>>;
}) {
  return input.request.telemetry.kind === 'enabled'
    ? {
        kind: 'enabled' as const,
        controller: composeTelemetryController({
          started: input.started,
          telemetry: input.request.telemetry,
        }),
      }
    : { kind: 'disabled' as const };
}

function requiredContainer(
  containers: ReadonlyMap<string, ComposeContainer>,
  service: string,
): ComposeContainer {
  const container = containers.get(service);
  if (container === undefined) {
    throw new Error(`Compose service ${JSON.stringify(service)} was not selected for the sandbox`);
  }
  return container;
}

/** Takes the project down outside a started environment, as Testcontainers does after a failed `up()`. */
async function composeDown(input: {
  readonly client: Awaited<ReturnType<typeof getContainerRuntimeClient>>;
  readonly request: ComposeStartRequest;
  readonly composeFiles: readonly string[];
}): Promise<void> {
  await input.client.compose.down(
    {
      filePath: input.request.projectDirectory,
      files: [...input.composeFiles],
      projectName: input.request.projectName,
      environment: { ...composeEnvironment(input.request) },
    },
    { removeVolumes: true, timeout: 0 },
  );
}

export class TestcontainersComposeDriver implements ComposeSandboxDriver {
  async start(request: ComposeStartRequest): Promise<StartedComposeSandbox> {
    const client = await getContainerRuntimeClient();
    const observation = composeObservationClient(client.container.dockerode);
    const composeFiles = await composeFilesFor(request, client.container.dockerode);
    const environment = new DockerComposeEnvironment(request.projectDirectory, [
      ...composeFiles,
    ])
      .withBuild()
      .withProjectName(request.projectName)
      .withEnvironment(composeEnvironment(request))
      .withDefaultWaitStrategy(new SandboxReadinessWaitStrategy())
      .withStartupTimeout(request.startupTimeoutMs);
    const services = selectedServices(request);
    const inspect = ({ signal }: { readonly signal: AbortSignal }) =>
      inspectComposeStartup({ docker: observation, projectName: request.projectName, signal });
    const observer = observeComposeStartup({
      mode: request.observation,
      now: Date.now,
      intervalMs: 500,
      awaiting: request.endpoints.map(({ service, containerPort }) => ({ service, containerPort })),
      inspect,
    });
    const started = await upUnlessParticipantExits({
      up: () => environment.up(services),
      requiredServices: requiredServiceNames(request),
      inspect,
      down: () => composeDown({ client, request, composeFiles }),
      intervalMs: 500,
    }).finally(() => observer.stop());
    const containers = await afterStartOrCleanup({
      started,
      operation: () => inspectSelectedContainers({
        request,
        started,
        docker: client.container.dockerode,
      }),
      failureMessage: 'Container inspection failed and Compose cleanup also failed',
    });
    const telemetry = await afterStartOrCleanup({
      started,
      operation: () => telemetryController({ request, started }),
      failureMessage: 'Telemetry setup failed and Compose cleanup also failed',
    });
    return {
      getContainer(input): ComposeContainer {
        return requiredContainer(containers, input.service);
      },
      async execute(input) {
        const container = started.getContainer(`${input.service}-1`);
        const result = await container.exec([...input.argv]);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          combined: result.output,
        };
      },
      inspectResources: (input) => inspectComposeResources(input),
      async inspectTelemetry() {
        if (telemetry.kind === 'disabled') {
          return { kind: 'disabled' };
        }
        return telemetry.controller.inspect();
      },
      async prepareStop(input): Promise<void> {
        if (telemetry.kind === 'disabled') {
          return;
        }
        await telemetry.controller.prepareStop(input);
      },
      async stop(input): Promise<void> {
        await started.down({
          timeout: input.timeoutMs,
          removeVolumes: true,
        });
      },
    };
  }
}
