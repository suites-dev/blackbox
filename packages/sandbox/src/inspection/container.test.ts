import { expect, it, vi } from 'vitest';
import type { ComposeSandboxDriver } from '../types.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from '../lifecycle/runtime.fixture.js';
import { SandboxRuntime } from '../lifecycle/runtime.js';

it('supports the complete readonly map and container inspection surface', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  expect(handle.containers.size).toBe(1);
  expect(handle.containers.has('orders')).toBe(true);
  expect([...handle.containers.keys()]).toEqual(['orders']);
  expect([...handle.containers.values()]).toHaveLength(1);
  expect([...handle.containers.entries()]).toHaveLength(1);
  expect([...handle.containers]).toHaveLength(1);
  const visit = vi.fn();
  handle.containers.forEach(visit);
  expect(visit).toHaveBeenCalledOnce();
  const container = handle.getContainer({ service: 'orders' });
  expect(container.testcontainer.getMappedPort({ containerPort: 3000 })).toBe(13_000);
  expect(() => handle.getContainer({ service: 'missing' })).toThrow('not explicitly selected');
  await handle.stop({ reason: 'completed' });
});
