import { expect, it } from 'vitest';

import { cleanupOwnedComposeProject } from './cleanup.js';
import type { ComposeRecoveryClient, RecoveryResource } from './types.js';

const projectName = 'bb-owned-project';
const ownedLabels = {
  kind: 'available',
  values: { 'com.docker.compose.project': projectName },
} satisfies RecoveryResource['labels'];

function initialResources(): Set<string> {
  return new Set(['container-1', 'network-1', 'volume-1']);
}

function recoveryClient(events: string[], resources = initialResources()): ComposeRecoveryClient {
  function list(kind: string, queriedProject: string): Promise<string[]> {
    expect(queriedProject).toBe(projectName);
    events.push(`list-${kind}s`);
    return Promise.resolve([...resources].filter((id) => id.startsWith(`${kind}-`)));
  }

  return {
    listContainers: (input) => list('container', input.projectName),
    inspectContainer: ({ id }) => {
      events.push(`inspect-container:${id}`);
      return Promise.resolve({ id, running: true, labels: ownedLabels });
    },
    stopContainer: ({ id }) => {
      events.push(`stop-container:${id}`);
      return Promise.resolve();
    },
    removeContainer: ({ id, removeAttachedVolumes }) => {
      events.push(`remove-container:${id}:${removeAttachedVolumes}`);
      resources.delete(id);
      return Promise.resolve();
    },
    listNetworks: (input) => list('network', input.projectName),
    inspectNetwork: ({ id }) => {
      events.push(`inspect-network:${id}`);
      return Promise.resolve({ id, labels: ownedLabels });
    },
    removeNetwork: ({ id }) => {
      events.push(`remove-network:${id}`);
      resources.delete(id);
      return Promise.resolve();
    },
    listVolumes: (input) => list('volume', input.projectName),
    inspectVolume: ({ id }) => {
      events.push(`inspect-volume:${id}`);
      return Promise.resolve({ id, labels: ownedLabels });
    },
    removeVolume: ({ id }) => {
      events.push(`remove-volume:${id}`);
      resources.delete(id);
      return Promise.resolve();
    },
  };
}

it('removes exact-owned containers before networks and volumes, including attached volumes', async () => {
  const events: string[] = [];
  await cleanupOwnedComposeProject({
    cleanup: { projectName, timeoutMs: 1000 },
    client: recoveryClient(events),
  });
  expect(events.filter((event) => event === 'inspect-container:container-1')).toHaveLength(1);
  expect(events).toContain('remove-container:container-1:true');
  expect(events.indexOf('remove-container:container-1:true'))
    .toBeLessThan(events.indexOf('list-networks'));
  expect(events).toContain('remove-network:network-1');
  expect(events).toContain('remove-volume:volume-1');
});

const ownershipCases = [
  { kind: 'container', removal: 'remove-container:container-1:true' },
  { kind: 'network', removal: 'remove-network:network-1' },
  { kind: 'volume', removal: 'remove-volume:volume-1' },
] satisfies readonly {
  readonly kind: 'container' | 'network' | 'volume';
  readonly removal: string;
}[];

it.each(ownershipCases)(
  'refuses a $kind whose exact inspected ownership label does not match',
  async ({ kind, removal }) => {
    const events: string[] = [];
    const base = recoveryClient(events);
    const foreign = {
      kind: 'available',
      values: { 'com.docker.compose.project': 'somebody-else' },
    } satisfies RecoveryResource['labels'];
    const client = {
      ...base,
      inspectContainer: kind === 'container'
        ? ({ id }: { readonly id: string }) => Promise.resolve({
            id, running: true, labels: foreign,
          })
        : base.inspectContainer,
      inspectNetwork: kind === 'network'
        ? ({ id }: { readonly id: string }) => Promise.resolve({ id, labels: foreign })
        : base.inspectNetwork,
      inspectVolume: kind === 'volume'
        ? ({ id }: { readonly id: string }) => Promise.resolve({ id, labels: foreign })
        : base.inspectVolume,
    } satisfies ComposeRecoveryClient;
    await expect(cleanupOwnedComposeProject({
      cleanup: { projectName, timeoutMs: 1000 },
      client,
    })).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [expect.objectContaining({
        message: expect.stringMatching(/without exact Compose ownership label/u),
      })],
    });
    expect(events).not.toContain(removal);
  },
);

it('treats resources that disappeared after discovery as already cleaned', async () => {
  const events: string[] = [];
  const resources = initialResources();
  const base = recoveryClient(events, resources);
  const missing = ({ id }: { readonly id: string }) => {
    resources.delete(id);
    return Promise.reject(Object.assign(new Error('gone'), { statusCode: 404 }));
  };
  const client = {
    ...base,
    inspectContainer: missing,
    inspectNetwork: missing,
    inspectVolume: missing,
  } satisfies ComposeRecoveryClient;
  await expect(cleanupOwnedComposeProject({
    cleanup: { projectName, timeoutMs: 1000 },
    client,
  })).resolves.toBeUndefined();
  expect(events.some((event) => event.startsWith('remove-'))).toBe(false);
});

it('gives Docker a stop grace inside the recovery budget, not the whole budget', async () => {
  const graces: number[] = [];
  await cleanupOwnedComposeProject({
    cleanup: { projectName, timeoutMs: 60_000 },
    client: {
      ...recoveryClient([]),
      stopContainer: ({ timeoutSeconds }) => {
        graces.push(timeoutSeconds);
        return Promise.resolve();
      },
    },
  });
  expect(graces).toEqual([10]);
});

it.each(ownershipCases)(
  'rejects an acknowledged removal when the $kind remains and retries only that resource',
  async ({ kind, removal }) => {
    const events: string[] = [];
    const base = recoveryClient(events);
    const acknowledge = () => Promise.resolve();
    const client = {
      ...base,
      removeContainer: kind === 'container' ? acknowledge : base.removeContainer,
      removeNetwork: kind === 'network' ? acknowledge : base.removeNetwork,
      removeVolume: kind === 'volume' ? acknowledge : base.removeVolume,
    } satisfies ComposeRecoveryClient;
    const cleanup = { projectName, timeoutMs: 1000 };

    await expect(cleanupOwnedComposeProject({ cleanup, client }))
      .rejects.toThrow(`still present: ${kind} ${kind}-1`);

    events.length = 0;
    await cleanupOwnedComposeProject({ cleanup, client: base });
    expect(events.filter((event) => event.startsWith('remove-'))).toEqual([removal]);
  },
);

it('rejects recovery when Docker cannot verify the final volume inventory', async () => {
  const resources = initialResources();
  const base = recoveryClient([], resources);
  const client = {
    ...base,
    listVolumes: (input) => resources.has('volume-1')
      ? base.listVolumes(input)
      : Promise.reject(new Error('volume inventory unavailable')),
  } satisfies ComposeRecoveryClient;

  await expect(cleanupOwnedComposeProject({ cleanup: { projectName, timeoutMs: 1000 }, client }))
    .rejects.toThrow('volume inventory unavailable');
});

it('names resources that appeared after discovery and leaves them for an explicit retry', async () => {
  const resources = initialResources();
  const base = recoveryClient([], resources);
  const client = {
    ...base,
    removeVolume: async (input) => {
      await base.removeVolume(input);
      resources.add('network-late');
      resources.add('volume-late');
    },
  } satisfies ComposeRecoveryClient;

  await expect(cleanupOwnedComposeProject({ cleanup: { projectName, timeoutMs: 1000 }, client }))
    .rejects.toThrow('still present: network network-late, volume volume-late');
  expect(resources).toEqual(new Set(['network-late', 'volume-late']));
});
