import { expect, it, vi } from 'vitest';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from '../lifecycle/runtime.fixture.js';
import { SandboxRuntime } from '../lifecycle/runtime.js';
import type { ComposeSandboxDriver, SandboxExecuteInput } from '../types.js';

it('executes exact argv through the private container capability', async () => {
  const { input } = await sandboxFixture();
  const execute = vi.fn(() =>
    Promise.resolve({
      exitCode: 7,
      stdout: 'stdout value',
      stderr: 'stderr value',
      combined: 'combined value',
    }),
  );
  const driver = {
    start: () => Promise.resolve({ ...startedSandbox({ stop: () => Promise.resolve() }), execute }),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  const argv = ['sh', '-c', 'printf "%s" "$1"', 'shell', 'a b;$HOME'] as const;
  await expect(
    handle.execute({ kind: 'container-exec', service: 'orders', argv }),
  ).resolves.toEqual({
    kind: 'exited',
    service: 'orders',
    exitCode: 7,
    stdout: 'stdout value',
    stderr: 'stderr value',
    combined: 'combined value',
  });
  expect(execute).toHaveBeenCalledWith({ kind: 'container-exec', service: 'orders', argv });
  await handle.stop({ reason: 'completed' });
});

it('returns explicit validation, lifecycle, and runtime failures', async () => {
  const { input } = await sandboxFixture();
  const failure = Object.assign(new Error('exec transport failed'), {
    stdout: 'partial stdout',
    stderr: 'partial stderr',
    output: 'combined partial output',
  });
  const execute = vi.fn(() => Promise.reject(failure));
  const driver = {
    start: () => Promise.resolve({ ...startedSandbox({ stop: () => Promise.resolve() }), execute }),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await expect(
    handle.execute({ kind: 'container-exec', service: 'missing', argv: ['true'] }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'unknown-service', service: 'missing' },
  });
  const malformedValue = { kind: 'container-exec', service: 'orders', argv: [] };
  const malformed: unknown = malformedValue;
  await expect(handle.execute(malformed as SandboxExecuteInput)).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'invalid-argv', reason: 'empty' },
  });
  await expect(
    handle.execute({ kind: 'container-exec', service: 'orders', argv: ['false'] }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      error: { name: 'Error', message: 'exec transport failed' },
      output: {
        kind: 'captured',
        stdout: 'partial stdout',
        stderr: 'partial stderr',
        combined: 'combined partial output',
      },
    },
  });
  await handle.stop({ reason: 'completed' });
  await expect(
    handle.execute({ kind: 'container-exec', service: 'orders', argv: ['true'] }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'sandbox-not-running', state: 'completed' },
  });
  expect(execute).toHaveBeenCalledOnce();
});

it('reports unavailable output when execution throws without captured streams', async () => {
  const { input } = await sandboxFixture();
  const execute = vi.fn(() => Promise.reject(new Error('transport vanished')));
  const driver = {
    start: () => Promise.resolve({ ...startedSandbox({ stop: () => Promise.resolve() }), execute }),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await expect(
    handle.execute({ kind: 'container-exec', service: 'orders', argv: ['true'] }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      error: { name: 'Error', message: 'transport vanished' },
      output: { kind: 'unavailable' },
    },
  });
  await handle.stop({ reason: 'completed' });
});
