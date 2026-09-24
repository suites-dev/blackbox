import { expect, it, vi } from 'vitest';
import type { ComposeAcquisitionObservation } from '../observation.js';
import { inspectComposeStartup, type ComposeObservationClient } from './observation-inspector.js';
import { observeComposeStartup } from './startup-observer.js';

type VolumeInventory = Awaited<ReturnType<ComposeObservationClient['listVolumes']>>;

function unavailableVolumes(): VolumeInventory {
  return { kind: 'unavailable' };
}

it('reports unavailable inventory until inspection establishes an explicit empty inventory', async () => {
  let volumes = unavailableVolumes();
  const docker = {
    listContainers: () => Promise.resolve([]),
    listNetworks: () => Promise.resolve([]),
    listVolumes: () => Promise.resolve(volumes),
    getContainer: () => {
      throw new Error('No containers were listed');
    },
  } satisfies ComposeObservationClient;
  const events: ComposeAcquisitionObservation[] = [];
  const observer = observeComposeStartup({
    mode: { kind: 'events', emit: (event) => events.push(event) },
    inspect: ({ signal }) => inspectComposeStartup({ docker, projectName: 'owned', signal }),
    now: () => 0,
    intervalMs: 1,
  });
  try {
    await vi.waitFor(() => {
      expect(events).toContainEqual({ kind: 'observation-status', status: 'unavailable' });
    });
    expect(events.some((event) => event.kind === 'resource-discovered')).toBe(false);
    expect(events).not.toContainEqual({ kind: 'observation-status', status: 'available' });
    volumes = { kind: 'available', volumes: [] };
    await vi.waitFor(() => {
      expect(events).toContainEqual({ kind: 'observation-status', status: 'available' });
    });
    expect(
      await inspectComposeStartup({
        docker,
        projectName: 'owned',
        signal: new AbortController().signal,
      }),
    ).toStrictEqual({ containers: [], resources: [] });
    expect(JSON.parse(JSON.stringify(events))).toStrictEqual(events);
  } finally {
    await observer.stop();
  }
});
