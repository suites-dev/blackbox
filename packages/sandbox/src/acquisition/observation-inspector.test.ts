import { expect, it, vi } from 'vitest';
import { inspectComposeStartup } from './observation-inspector.js';

const label = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';
function inspectorFixture() {
  const inspect = vi.fn().mockResolvedValue({
    Id: 'own-id', Name: '/own-api', Config: { Labels: { [label]: 'own', [serviceLabel]: 'api' } },
    State: { Status: 'running', Health: { Status: 'healthy' }, ExitCode: 0 },
  });
  const docker = {
    listContainers: vi.fn().mockResolvedValue([{ Id: 'own-id', Labels: { [label]: 'own' } }, { Id: 'foreign', Labels: { [label]: 'other' } }]),
    listNetworks: vi.fn().mockResolvedValue([{ Name: 'own-net', Labels: { [label]: 'own' } }, { Name: 'foreign', Labels: { [label]: 'other' } }, { Name: 'unlabeled' }]),
    listVolumes: vi.fn().mockResolvedValue({ Volumes: [{ Name: 'own-volume', Labels: { [label]: 'own' } }, { Name: 'foreign', Labels: { [label]: 'other' } }] }),
    getContainer: vi.fn(() => ({ inspect })),
  };
  return { inspect, docker, input: { docker: docker as Parameters<typeof inspectComposeStartup>[0]['docker'], projectName: 'own', signal: new AbortController().signal } };
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
    containers: [{ service: 'api', containerId: 'own-id', containerName: 'own-api', state: 'running', health: 'healthy', termination: { kind: 'none' } }],
    resources: [{ kind: 'network', name: 'own-net' }, { kind: 'volume', name: 'own-volume' }],
  });
});

it.each(['other', undefined])('rejects a container whose inspected project changed to %s', async (project) => {
  const fixture = inspectorFixture();
  fixture.inspect.mockResolvedValue({ Config: { Labels: { [label]: project, [serviceLabel]: 'api' } } });
  expect((await inspectComposeStartup(fixture.input)).containers).toEqual([]);
});

it.each([
  ['exited', undefined, 'exited', 'not-configured', { kind: 'exited', exitCode: 7 }],
  ['dead', 'unhealthy', 'dead', 'unhealthy', { kind: 'exited', exitCode: 7 }],
  ['surprise', 'surprise', 'unknown', 'unknown', { kind: 'none' }],
])('preserves %s failure/unknown states without exposing logs or environment', async (state, health, expectedState, expectedHealth, termination) => {
  const fixture = inspectorFixture();
  fixture.inspect.mockResolvedValue({
    Id: 'own-id', Name: '/own-api',
    Config: { Labels: { [label]: 'own', [serviceLabel]: 'api' }, Env: ['TOKEN=secret'] },
    State: { Status: state, Health: health === undefined ? undefined : { Status: health, Log: ['secret-health-output'] }, ExitCode: 7, Error: 'secret-daemon-error' },
  });
  fixture.docker.listVolumes.mockResolvedValue({ Volumes: null });
  const snapshot = await inspectComposeStartup(fixture.input);
  expect(snapshot.containers[0]).toMatchObject({ state: expectedState, health: expectedHealth, termination });
  expect(JSON.stringify(snapshot)).not.toContain('secret');
});
