import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ComposeStartRequest } from '../../types.js';
import { TestcontainersComposeDriver } from '../testcontainers-driver.js';

const docker = vi.hoisted(() => {
  const inspect = vi.fn<() => Promise<unknown>>();
  const down = vi.fn<() => Promise<void>>();
  const container = {
    getId: () => 'owned-container-id', getName: () => 'owned-api-1',
    getHost: () => '127.0.0.1', getLabels: () => ({ 'com.docker.compose.project': 'owned' }),
    getNetworkNames: () => ['owned_default'], getMappedPort: () => 12345,
  };
  return { inspect, down,
    build: vi.fn(),
    selected: vi.fn((_service: string) => container),
    lookup: vi.fn((_id: string) => ({ inspect })),
    up: vi.fn<(services: string[] | undefined) => void>(),
  };
});

vi.mock('testcontainers', () => ({
  DockerComposeEnvironment: class {
    withBuild() { docker.build(); return this; }
    withProjectName() { return this; }
    withEnvironment() { return this; }
    withStartupTimeout() { return this; }
    up(services: string[] | undefined) {
      docker.up(services);
      return Promise.resolve({ getContainer: docker.selected, down: docker.down });
    }
  },
  getContainerRuntimeClient: () => Promise.resolve({
    container: { dockerode: { getContainer: docker.lookup } },
  }),
}));

const roots: string[] = [];

async function request(): Promise<ComposeStartRequest> {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'sandbox-env-inspection-'));
  roots.push(projectDirectory);
  return { observation: { kind: 'silent' }, projectDirectory,
    composeFiles: ['compose.yml'], projectName: 'owned', environment: {},
    serviceSelection: { kind: 'selected', services: ['api'] }, startupTimeoutMs: 100,
    endpoints: [], telemetry: { kind: 'disabled' },
    generatedComposeDirectory: join(projectDirectory, 'generated') };
}

async function telemetryRequest(): Promise<ComposeStartRequest> {
  const input = await request();
  return {
    ...input,
    telemetry: {
      kind: 'enabled',
      sessionId: 'quiet-river-ada',
      executionId: 'sandbox-1',
      authorization: { kind: 'bearer-token', token: 'private-token' },
      collector: {
        service: 'blackbox-collector',
        containerPort: 4318,
        runtime: {
          kind: 'image-default',
          image: 'blackbox-collector:test',
        },
        environment: {},
        readiness: {
          kind: 'http',
          path: '/ready',
          intervalSeconds: 1,
          timeoutSeconds: 1,
          retries: 3,
        },
        drain: { kind: 'signal', signal: 'SIGTERM' },
      },
      participants: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  docker.inspect.mockResolvedValue({ Config: { Env: ['PRIVATE=effective=value', 'EMPTY='] } });
  docker.down.mockResolvedValue();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['selected', 'all'] as const)('inspects only the exact acquired container for %s selection', async (kind) => {
  const input = await request();
  const started = await new TestcontainersComposeDriver().start({ ...input,
    serviceSelection: kind === 'selected'
      ? { kind, services: ['api'] } : { kind, declaredServices: ['api'] },
  });
  expect(docker.up).toHaveBeenCalledWith(kind === 'selected' ? ['api'] : undefined);
  expect(docker.build).toHaveBeenCalledOnce();
  expect(docker.selected.mock.calls).toEqual([['api-1']]);
  expect(docker.lookup.mock.calls).toEqual([['owned-container-id']]);
  expect(docker.inspect).toHaveBeenCalledOnce();
  const container = started.getContainer({ service: 'api' });
  expect(container.environment).toEqual({ PRIVATE: 'effective=value', EMPTY: '' });
  expect(Object.isFrozen(container.environment)).toBe(true);
  expect(() => started.getContainer({ service: 'foreign' })).toThrow('was not selected');
  expect(docker.down).not.toHaveBeenCalled();
});

it('cleans up acquired containers when environment inspection is malformed without leaking its value', async () => {
  const secret = 'malformed-private-environment';
  docker.inspect.mockResolvedValue({ Config: { Env: [secret] } });
  await expect(new TestcontainersComposeDriver().start(await request()))
    .rejects.toThrow('Malformed Docker container environment entry at index 0');
  expect(docker.down).toHaveBeenCalledExactlyOnceWith({ removeVolumes: true });
});

it('starts the collector alongside an explicit application service selection', async () => {
  await new TestcontainersComposeDriver().start(await telemetryRequest());
  expect(docker.up).toHaveBeenCalledWith(['api', 'blackbox-collector']);
  expect(docker.selected.mock.calls).toEqual([
    ['api-1'],
    ['blackbox-collector-1'],
  ]);
});

it('cleans up if the selected collector cannot be resolved after startup', async () => {
  docker.selected
    .mockImplementationOnce((_service: string) => ({
      getId: () => 'owned-container-id', getName: () => 'owned-api-1',
      getHost: () => '127.0.0.1',
      getLabels: () => ({ 'com.docker.compose.project': 'owned' }),
      getNetworkNames: () => ['owned_default'], getMappedPort: () => 12345,
    }))
    .mockImplementationOnce(() => {
      throw new Error('collector was not started');
    });
  await expect(new TestcontainersComposeDriver().start(await telemetryRequest()))
    .rejects.toThrow('collector was not started');
  expect(docker.down).toHaveBeenCalledExactlyOnceWith({ removeVolumes: true });
});

it('preserves the primary inspection error and a secondary cleanup error', async () => {
  const inspection = new Error('inspect unavailable');
  const cleanup = new Error('cleanup unavailable');
  docker.inspect.mockRejectedValue(inspection);
  docker.down.mockRejectedValue(cleanup);
  await expect(new TestcontainersComposeDriver().start(await request()))
    .rejects.toMatchObject({ name: 'AggregateError', errors: [inspection, cleanup] });
  expect(docker.down).toHaveBeenCalledExactlyOnceWith({ removeVolumes: true });
});
