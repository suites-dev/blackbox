import { expect, it, vi } from 'vitest';

import type { ComposeObservationClient } from './observation-inspector.js';
import { inspectComposeProjectWith } from './project-inspection.js';

const project = { kind: 'available' as const, values: { 'com.docker.compose.project': 'bb-own' } };

it('reports an exited container of the project with its exit code, bounded by a timeout', async () => {
  const inspect = vi.fn().mockResolvedValue({
    id: 'db-id',
    name: '/bb-own-db-1',
    labels: {
      kind: 'available',
      values: { ...project.values, 'com.docker.compose.service': 'db' },
    },
    state: { status: 'exited', health: { kind: 'not-configured' }, exitCode: 137 },
  });
  const docker = {
    listContainers: vi.fn().mockResolvedValue([{ id: 'db-id', labels: project }]),
    listNetworks: vi.fn().mockResolvedValue([]),
    listVolumes: vi.fn().mockResolvedValue({ kind: 'available' as const, volumes: [] }),
    getContainer: vi.fn(() => ({ inspect })),
  } satisfies ComposeObservationClient;
  const snapshot = await inspectComposeProjectWith(docker, {
    projectName: 'bb-own',
    timeoutMs: 1_000,
  });
  expect(snapshot.containers).toEqual([
    {
      service: 'db',
      containerId: 'db-id',
      containerName: 'bb-own-db-1',
      state: 'exited',
      health: 'not-configured',
      termination: { kind: 'exited', exitCode: 137 },
    },
  ]);
  const [options] = docker.listContainers.mock.calls[0] as [{ abortSignal: AbortSignal }];
  expect(options.abortSignal.aborted).toBe(false);
  expect(options).toMatchObject({
    all: true,
    filters: { label: ['com.docker.compose.project=bb-own'] },
  });
});
