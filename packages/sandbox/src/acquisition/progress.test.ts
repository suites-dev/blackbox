import { expect, it, vi } from 'vitest';
import {
  deterministicClock,
  sandboxFixture,
  startedSandbox,
} from '../lifecycle/runtime.fixture.js';
import { SandboxRuntime } from '../lifecycle/runtime.js';
import type { ComposeSandboxDriver } from '../types.js';
import type { SandboxProgressEvent } from './progress.js';

it('reports only established acquisition milestones and owned resources', async () => {
  const { input } = await sandboxFixture();
  const events: SandboxProgressEvent[] = [];
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start({
    sandbox: input,
    progress: { kind: 'events', sink: { emit: (event) => events.push(event) } },
  });

  expect(events.map((event) => event.kind)).toEqual([
    'acquisition-started',
    'containers-acquired',
    'resources-ready',
  ]);
  const resources = handle.inspectResources({ kind: 'owned-compose-resources' });
  expect(resources.projectName).toBe(handle.projectName);
  expect(resources.networks).toEqual([
    expect.objectContaining({ kind: 'network', id: 'network-id' }),
  ]);
  expect(resources.volumes).toEqual([expect.objectContaining({ kind: 'volume' })]);
  expect(Object.isFrozen(resources)).toBe(true);
  expect(Object.isFrozen(resources.networks)).toBe(true);
  const [network] = resources.networks;
  expect(network).toBeDefined();
  expect(Object.isFrozen(network.labels)).toBe(true);
  await handle.stop({ reason: 'completed' });
});

it('reports acquisition failure and cleans resources with the wrong project identity', async () => {
  const { input } = await sandboxFixture();
  const stop = vi.fn(() => Promise.resolve());
  const compose = startedSandbox({ stop });
  const driver = {
    start: () =>
      Promise.resolve({
        ...compose,
        inspectResources: () =>
          Promise.resolve({
            kind: 'owned-compose-resources' as const,
            projectName: 'foreign-project',
            networks: [],
            volumes: [],
          }),
      }),
  } satisfies ComposeSandboxDriver;
  const events: SandboxProgressEvent[] = [];
  await expect(
    new SandboxRuntime({ driver, now: deterministicClock(), onEvent: () => undefined }).start({
      sandbox: input,
      progress: { kind: 'events', sink: { emit: (event) => events.push(event) } },
    }),
  ).rejects.toMatchObject({ name: 'SandboxStartError' });
  expect(events.map((event) => event.kind)).toEqual([
    'acquisition-started',
    'containers-acquired',
    'acquisition-failed',
  ]);
  expect(stop).toHaveBeenCalledOnce();
});

it('does not let a progress sink failure alter acquisition truth', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start({
    sandbox: input,
    progress: {
      kind: 'events',
      sink: {
        emit: () => {
          throw new Error('display failed');
        },
      },
    },
  });
  expect(handle.state).toBe('running');
  await handle.stop({ reason: 'completed' });
});
