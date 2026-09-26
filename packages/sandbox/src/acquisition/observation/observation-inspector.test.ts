import { expect, it, vi } from 'vitest';
import { inspectComposeStartup, type ComposeObservationClient } from './observation-inspector.js';

const label = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';

function available(values: Readonly<Record<string, string>>) {
  return { kind: 'available' as const, values };
}

function inspectorFixture() {
  const inspect = vi.fn().mockResolvedValue({
    id: 'own-id',
    name: '/own-api',
    labels: available({ [label]: 'own', [serviceLabel]: 'api' }),
    state: { status: 'running', health: { kind: 'reported', status: 'healthy' }, exitCode: 0 },
  });
  const docker = {
    listContainers: vi.fn().mockResolvedValue([
      { id: 'own-id', labels: available({ [label]: 'own' }) },
      { id: 'foreign', labels: available({ [label]: 'other' }) },
    ]),
    listNetworks: vi.fn().mockResolvedValue([
      { name: 'own-net', labels: available({ [label]: 'own' }) },
      { name: 'foreign', labels: available({ [label]: 'other' }) },
      { name: 'unlabeled', labels: { kind: 'unavailable' as const } },
    ]),
    listVolumes: vi.fn().mockResolvedValue({
      kind: 'available' as const,
      volumes: [
        { name: 'own-volume', labels: available({ [label]: 'own' }) },
        { name: 'foreign', labels: available({ [label]: 'other' }) },
      ],
    }),
    getContainer: vi.fn(() => ({ inspect })),
  };
  return {
    inspect,
    docker,
    input: {
      docker: docker satisfies ComposeObservationClient,
      projectName: 'own',
      signal: new AbortController().signal,
    },
  };
}

it('filters every Docker query and independently rejects foreign returned resources', async () => {
  const fixture = inspectorFixture();
  const snapshot = await inspectComposeStartup(fixture.input);
  const options = { filters: { label: [`${label}=own`] }, abortSignal: fixture.input.signal };
  expect(fixture.docker.listContainers).toHaveBeenCalledWith({ ...options, all: true });
  expect(fixture.docker.listNetworks).toHaveBeenCalledWith(options);
  expect(fixture.docker.listVolumes).toHaveBeenCalledWith(options);
  expect(fixture.docker.getContainer.mock.calls).toEqual([['own-id']]);
  expect(fixture.inspect).toHaveBeenCalledWith({ abortSignal: fixture.input.signal });
  expect(snapshot).toEqual({
    containers: [
      {
        service: 'api',
        containerId: 'own-id',
        containerName: 'own-api',
        state: 'running',
        health: 'healthy',
        termination: { kind: 'none' },
      },
    ],
    resources: [
      { kind: 'network', name: 'own-net' },
      { kind: 'volume', name: 'own-volume' },
    ],
  });
});

it.each([
  ['foreign', available({ [label]: 'other', [serviceLabel]: 'api' })],
  ['unavailable', { kind: 'unavailable' as const }],
])('rejects a container whose inspected labels are %s', async (_name, labels) => {
  const fixture = inspectorFixture();
  fixture.inspect.mockResolvedValue({
    id: 'own-id',
    name: '/own-api',
    labels,
    state: { status: 'running', health: { kind: 'not-configured' }, exitCode: 0 },
  });
  expect((await inspectComposeStartup(fixture.input)).containers).toEqual([]);
});

it.each([
  [
    'exited',
    { kind: 'not-configured' },
    'exited',
    'not-configured',
    { kind: 'exited', exitCode: 7 },
  ],
  [
    'dead',
    { kind: 'reported', status: 'unhealthy' },
    'dead',
    'unhealthy',
    { kind: 'exited', exitCode: 7 },
  ],
  ['surprise', { kind: 'reported', status: 'surprise' }, 'unknown', 'unknown', { kind: 'none' }],
])(
  'preserves %s failure/unknown states without exposing logs or environment',
  async (state, health, expectedState, expectedHealth, termination) => {
    const fixture = inspectorFixture();
    fixture.inspect.mockResolvedValue({
      id: 'own-id',
      name: '/own-api',
      labels: available({ [label]: 'own', [serviceLabel]: 'api' }),
      state: { status: state, health, exitCode: 7 },
    });
    fixture.docker.listVolumes.mockResolvedValue({ kind: 'available', volumes: [] });
    const snapshot = await inspectComposeStartup(fixture.input);
    expect(snapshot.containers[0]).toMatchObject({
      state: expectedState,
      health: expectedHealth,
      termination,
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  },
);

it('rejects an unavailable volume inventory instead of reporting zero volumes', async () => {
  const fixture = inspectorFixture();
  fixture.docker.listVolumes.mockResolvedValue({ kind: 'unavailable' });
  await expect(inspectComposeStartup(fixture.input)).rejects.toThrow(
    'Docker volume inventory was unavailable',
  );
});
