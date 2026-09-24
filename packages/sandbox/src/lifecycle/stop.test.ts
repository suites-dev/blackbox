import { expect, it, vi } from 'vitest';
import { readSandboxRecord } from '../ownership/records.js';
import type { ComposeSandboxDriver } from '../types.js';
import { SandboxStopError } from './errors.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from './runtime.fixture.js';
import { SandboxRuntime } from './runtime.js';

it('stops once when concurrent and repeated callers request cleanup', async () => {
  const { input } = await sandboxFixture();
  const stop = vi.fn(() => Promise.resolve());
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  const first = handle.stop({ reason: 'completed' });
  const second = handle.stop({ reason: 'cancelled' });
  await expect(first).resolves.toEqual({
    kind: 'stopped',
    sandboxId: input.sandboxId,
    reason: 'completed',
    cleanup: 'complete',
  });
  await expect(second).resolves.toEqual({
    kind: 'stopped',
    sandboxId: input.sandboxId,
    reason: 'completed',
    cleanup: 'complete',
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledWith({ timeoutMs: 500 });
  expect(
    (
      await readSandboxRecord({
        recordDirectory: input.recordDirectory,
        sandboxId: input.sandboxId,
      })
    ).state,
  ).toBe('completed');
});

it('still tears Compose down when telemetry preparation fails', async () => {
  const { input } = await sandboxFixture();
  const stop = vi.fn(() => Promise.resolve());
  const compose = startedSandbox({ stop });
  const driver = {
    start: () =>
      Promise.resolve({
        ...compose,
        prepareStop: () => Promise.reject(new Error('collector drain failed')),
      }),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await expect(handle.stop({ reason: 'completed' })).rejects.toMatchObject({
    name: 'SandboxStopError',
  });
  expect(stop).toHaveBeenCalledOnce();
});

it('surfaces stop failure and never repeats failed cleanup', async () => {
  const { input } = await sandboxFixture();
  const stop = vi.fn(() => Promise.reject(new Error('daemon unavailable')));
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await expect(handle.stop({ reason: 'completed' })).rejects.toBeInstanceOf(SandboxStopError);
  await expect(handle.stop({ reason: 'completed' })).rejects.toBeInstanceOf(SandboxStopError);
  expect(stop).toHaveBeenCalledOnce();
  expect(
    (
      await readSandboxRecord({
        recordDirectory: input.recordDirectory,
        sandboxId: input.sandboxId,
      })
    ).state,
  ).toBe('stop-failed');
});

it('bounds cleanup that never settles', async () => {
  const { input } = await sandboxFixture();
  const stop = vi.fn(() => new Promise<void>(() => undefined));
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart({ ...input, stopTimeoutMs: 10 }));
  await expect(handle.stop({ reason: 'interrupted' })).rejects.toMatchObject({
    name: 'SandboxStopError',
    failure: {
      kind: 'cleanup-failed',
      cleanupError: expect.objectContaining({ message: 'Sandbox cleanup timed out after 10ms' }),
    },
  });
  expect(
    (
      await readSandboxRecord({
        recordDirectory: input.recordDirectory,
        sandboxId: input.sandboxId,
      })
    ).state,
  ).toBe('stop-failed');
});

it('does not let a lifecycle callback change the durable result', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => {
      throw new Error('presentation failed');
    },
  }).start(silentStart(input));
  await expect(handle.stop({ reason: 'completed' })).resolves.toMatchObject({
    kind: 'stopped',
    cleanup: 'complete',
  });
  expect(
    (
      await readSandboxRecord({
        recordDirectory: input.recordDirectory,
        sandboxId: input.sandboxId,
      })
    ).state,
  ).toBe('completed');
});
