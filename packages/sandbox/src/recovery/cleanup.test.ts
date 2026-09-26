import { expect, it } from 'vitest';

import { cleanupOwnedComposeProject } from './cleanup.js';
import type { ComposeRecoveryClient, RecoveryResource } from './types.js';

const projectName = 'bb-owned-project';
const ownedLabels = {
  kind: 'available',
  values: { 'com.docker.compose.project': projectName },
} satisfies RecoveryResource['labels'];

function recoveryClient(events: string[]): ComposeRecoveryClient {
  return {
    listContainers: () => {
      events.push('list-containers');
      return Promise.resolve(['container-1']);
    },
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
      return Promise.resolve();
    },
    listNetworks: () => {
      events.push('list-networks');
      return Promise.resolve(['network-1']);
    },
    inspectNetwork: ({ id }) => {
      events.push(`inspect-network:${id}`);
      return Promise.resolve({ id, labels: ownedLabels });
    },
    removeNetwork: ({ id }) => {
      events.push(`remove-network:${id}`);
      return Promise.resolve();
    },
    listVolumes: () => {
      events.push('list-volumes');
      return Promise.resolve(['volume-1']);
    },
    inspectVolume: ({ id }) => {
      events.push(`inspect-volume:${id}`);
      return Promise.resolve({ id, labels: ownedLabels });
    },
    removeVolume: ({ id }) => {
      events.push(`remove-volume:${id}`);
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
  const base = recoveryClient(events);
  const missing = () => Promise.reject(Object.assign(new Error('gone'), { statusCode: 404 }));
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
