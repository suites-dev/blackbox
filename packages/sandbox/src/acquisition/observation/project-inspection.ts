import { getContainerRuntimeClient } from 'testcontainers';

import type { ComposeObservationSnapshot } from '../observation.js';
import {
  composeObservationClient,
  inspectComposeStartup,
  type ComposeObservationClient,
} from './observation-inspector.js';

interface ProjectInspectionInput {
  readonly projectName: string;
  readonly timeoutMs: number;
}

/** {@link inspectComposeProject} through a given Docker client. */
export function inspectComposeProjectWith(
  docker: ComposeObservationClient,
  input: ProjectInspectionInput,
): Promise<ComposeObservationSnapshot> {
  return inspectComposeStartup({
    docker,
    projectName: input.projectName,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
}

/**
 * One Docker query for every container, network and volume labelled with a
 * Compose project, with each container's state and exit code. Read-only; the
 * same inventory the start-up observer polls.
 */
export async function inspectComposeProject(
  input: ProjectInspectionInput,
): Promise<ComposeObservationSnapshot> {
  const runtime = await getContainerRuntimeClient();
  return inspectComposeProjectWith(composeObservationClient(runtime.container.dockerode), input);
}
