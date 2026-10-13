import { expect, it, vi } from 'vitest';
import { readSandboxRecord } from '../ownership/records.js';
import type { ComposeSandboxDriver } from '../model/compose.js';
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

it('names the participants Docker still has when cleanup times out', async () => {
  const { input } = await sandboxFixture();
  const compose = startedSandbox({ stop: () => new Promise<void>(() => undefined) });
  const driver = {
    start: () =>
      Promise.resolve({
        ...compose,
        inspectRemainingContainers: () =>
          Promise.resolve([{ service: 'pokeapi-stub', state: 'running' }]),
      }),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart({ ...input, stopTimeoutMs: 10 }));
  const message =
    'Sandbox cleanup timed out after 10ms; still present: pokeapi-stub (running)';
  await expect(handle.stop({ reason: 'completed' })).rejects.toMatchObject({
    name: 'SandboxStopError',
    message: `Sandbox cleanup failed: ${message}`,
    failure: { kind: 'cleanup-failed', cleanupError: expect.objectContaining({ message }) },
  });
  expect(
    await readSandboxRecord({ recordDirectory: input.recordDirectory, sandboxId: input.sandboxId }),
  ).toMatchObject({ state: 'stop-failed', cleanup: { kind: 'failed', error: { message } } });
});

it('keeps the cleanup error when the remaining containers cannot be listed', async () => {
  const { input } = await sandboxFixture();
  const compose = startedSandbox({ stop: () => Promise.reject(new Error('daemon unavailable')) });
  const driver = {
    start: () =>
      Promise.resolve({
        ...compose,
        inspectRemainingContainers: () => Promise.reject(new Error('daemon unavailable')),
      }),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await expect(handle.stop({ reason: 'completed' })).rejects.toMatchObject({
    message: 'Sandbox cleanup failed: daemon unavailable',
  });
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
