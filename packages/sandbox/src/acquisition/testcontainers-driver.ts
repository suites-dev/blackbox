import { DockerComposeEnvironment, getContainerRuntimeClient } from 'testcontainers';
import type {
  ComposeContainer,
  ComposeSandboxDriver,
  ComposeStartRequest,
  StartedComposeSandbox,
} from '../types.js';
import {
  composeObservationClient,
  inspectComposeStartup,
} from './observation/observation-inspector.js';
import { observeComposeStartup } from './observation/startup-observer.js';
import { inspectComposeResources } from './resources/resource-inspector.js';
import { writeTelemetryComposeOverride } from '../telemetry/compose-override.js';
import { composeTelemetryController } from '../telemetry/compose-controller.js';
import { writeEndpointComposeOverride } from './endpoint-override.js';
import { snapshotContainerEnvironment } from './container-environment.js';

async function composeFilesFor(request: ComposeStartRequest): Promise<readonly string[]> {
  const endpointsOverride = await writeEndpointComposeOverride({
    endpoints: request.endpoints,
    directory: request.generatedComposeDirectory,
  });
  if (request.telemetry.kind === 'disabled') {
    return [...request.composeFiles, endpointsOverride];
  }
  const override = await writeTelemetryComposeOverride({
    telemetry: request.telemetry,
    directory: request.generatedComposeDirectory,
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

function selectedServiceNames(request: ComposeStartRequest): readonly string[] {
  return request.serviceSelection.kind === 'selected'
    ? request.serviceSelection.services
    : request.serviceSelection.declaredServices;
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

export class TestcontainersComposeDriver implements ComposeSandboxDriver {
  async start(request: ComposeStartRequest): Promise<StartedComposeSandbox> {
    const composeFiles = await composeFilesFor(request);
    const environment = new DockerComposeEnvironment(request.projectDirectory, [
      ...composeFiles,
    ])
      .withBuild()
      .withProjectName(request.projectName)
      .withEnvironment({
        ...request.environment,
        ...(request.telemetry.kind === 'enabled'
          ? { BLACKBOX_SANDBOX_OTEL_AUTH_TOKEN: request.telemetry.authorization.token }
          : {}),
      })
      .withStartupTimeout(request.startupTimeoutMs);
    const services = selectedServices(request);
    const client = await getContainerRuntimeClient();
    const observer = observeComposeStartup({
      mode: request.observation,
      now: Date.now,
      intervalMs: 500,
      inspect: ({ signal }) =>
        inspectComposeStartup({
          docker: composeObservationClient(client.container.dockerode),
          projectName: request.projectName,
          signal,
        }),
    });
    const started = await environment.up(services).finally(() => observer.stop());
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
