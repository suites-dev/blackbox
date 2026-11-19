import type { getContainerRuntimeClient } from 'testcontainers';
import type { ComposeStartRequest } from '../model/compose.js';
import { writeTelemetryComposeOverride } from '../telemetry/compose-override.js';
import { writeEndpointComposeOverride } from './endpoint-override.js';
import { inspectEffectiveParticipantEnvironments } from './environment/effective.js';

type Dockerode = Awaited<
  ReturnType<typeof getContainerRuntimeClient>
>['container']['dockerode'];

export async function composeFilesFor(
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
