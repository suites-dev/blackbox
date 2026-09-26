import assert from 'node:assert/strict';
import type { SandboxHandle } from '../../types.js';
import type { SandboxProgressEvent } from '../progress.js';
import { resourcesForProjects } from './docker-inspection.fixture.js';

export async function verifyResourceReports(input: {
  readonly handles: readonly SandboxHandle[];
  readonly projectNames: readonly string[];
  readonly events: readonly SandboxProgressEvent[];
}): Promise<void> {
  const live = await resourcesForProjects({ projectNames: input.projectNames });
  const reportedNetworks: string[] = [];
  const reportedVolumes: string[] = [];
  for (const [index, handle] of input.handles.entries()) {
    const expectedProject = input.projectNames[index];
    const resources = handle.inspectResources({ kind: 'owned-compose-resources' });
    assert.equal(resources.projectName, expectedProject);
    assert.equal(resources.containers.length, 1);
    const [container] = resources.containers;
    assert.notEqual(container, undefined);
    assert.equal(container.service, 'echo');
    for (const network of resources.networks) {
      assert.equal(network.labels['com.docker.compose.project'], expectedProject);
      reportedNetworks.push(network.id.slice(0, 12));
    }
    for (const volume of resources.volumes) {
      assert.equal(volume.labels['com.docker.compose.project'], expectedProject);
      reportedVolumes.push(volume.name);
    }
    verifyProgress({ sandboxId: handle.sandboxId, events: input.events });
  }
  assert.deepEqual(reportedNetworks.sort(), [...live.networks].sort());
  assert.deepEqual(reportedVolumes.sort(), [...live.volumes].sort());
}

function verifyProgress(input: {
  readonly sandboxId: string;
  readonly events: readonly SandboxProgressEvent[];
}): void {
  const events = input.events.filter((event) => event.sandboxId === input.sandboxId);
  assert.deepEqual(
    events.filter((event) => event.kind !== 'acquisition-observation').map((event) => event.kind),
    ['acquisition-started', 'containers-acquired', 'resources-ready'],
  );
}
