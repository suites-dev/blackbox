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
  return request.serviceSelection.kind === 'selected'
    ? [...request.serviceSelection.services]
    : undefined;
}

export class TestcontainersComposeDriver implements ComposeSandboxDriver {
  async start(request: ComposeStartRequest): Promise<StartedComposeSandbox> {
    const composeFiles = await composeFilesFor(request);
    const environment = new DockerComposeEnvironment(request.projectDirectory, [
      ...composeFiles,
    ])
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
    const telemetry =
      request.telemetry.kind === 'enabled'
        ? {
            kind: 'enabled' as const,
            controller: composeTelemetryController({ started, telemetry: request.telemetry }),
          }
        : { kind: 'disabled' as const };
    return {
      getContainer(input): ComposeContainer {
        const container = started.getContainer(`${input.service}-1`);
        return {
          id: container.getId(),
          name: container.getName(),
          host: container.getHost(),
          labels: container.getLabels(),
          networkNames: container.getNetworkNames(),
          getMappedPort: (selector) => container.getMappedPort(selector.containerPort),
        };
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
