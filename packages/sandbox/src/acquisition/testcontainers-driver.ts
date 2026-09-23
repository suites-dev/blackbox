import { DockerComposeEnvironment, getContainerRuntimeClient } from 'testcontainers';
import type {
  ComposeContainer,
  ComposeSandboxDriver,
  ComposeStartRequest,
  StartedComposeSandbox,
} from '../types.js';
import { observeComposeStartup } from './startup-observer.js';
import { inspectComposeStartup } from './observation-inspector.js';
import { inspectComposeResources } from './resource-inspector.js';

export class TestcontainersComposeDriver implements ComposeSandboxDriver {
  async start(request: ComposeStartRequest): Promise<StartedComposeSandbox> {
    const environment = new DockerComposeEnvironment(request.projectDirectory, [
      ...request.composeFiles,
    ])
      .withProjectName(request.projectName)
      .withEnvironment({ ...request.environment })
      .withStartupTimeout(request.startupTimeoutMs);
    const services =
      request.serviceSelection.kind === 'selected'
        ? [...request.serviceSelection.services]
        : undefined;
    const client = await getContainerRuntimeClient();
    const observer = observeComposeStartup({
      mode: request.observation, now: Date.now, intervalMs: 500,
      inspect: ({ signal }) => inspectComposeStartup({
        docker: client.container.dockerode, projectName: request.projectName, signal,
      }),
    });
    const started = await environment.up(services).finally(() => observer.stop());
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
      async stop(input): Promise<void> {
        await started.down({
          timeout: input.timeoutMs,
          removeVolumes: true,
        });
      },
    };
  }
}
