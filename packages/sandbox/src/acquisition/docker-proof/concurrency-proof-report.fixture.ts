import { inspectedHostPort, type ContainerInspection } from './docker-inspection.fixture.js';
import type { ProofContext } from './concurrency-proof.fixture.js';

export function logProof(input: {
  readonly context: ProofContext;
  readonly containers: readonly ContainerInspection[];
  readonly ports: readonly number[];
  readonly identities: readonly string[];
}): void {
  process.stdout.write(
    `BLACKBOX_SANDBOX_DOCKER_PROOF ${JSON.stringify({
      proofToken: input.context.proofToken,
      projectNames: input.context.projectNames,
      ports: input.ports,
      identities: input.identities,
      docker: {
        containers: input.containers.map((container) => ({
          id: container.Id.slice(0, 12),
          name: container.Name,
          project: container.Config.Labels['com.docker.compose.project'],
          state: container.State.Status,
          port: inspectedHostPort({ container }),
          networks: Object.keys(container.NetworkSettings.Networks),
        })),
        networkCount: 5,
        volumeCount: 5,
      },
    })}\n`,
  );
}
