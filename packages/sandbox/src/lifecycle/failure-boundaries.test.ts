import { expect, it, vi } from 'vitest';

import { readSandboxRecord } from '../ownership/records.js';
import type { SandboxProgressEvent } from '../acquisition/progress.js';
import { SandboxRuntime } from './runtime.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from './runtime.fixture.js';

it('bounds cleanup after resource inspection failure and never announces resources ready', async () => {
  const { input } = await sandboxFixture();
  const stop = vi.fn(() => new Promise<void>(() => undefined));
  const events: SandboxProgressEvent[] = [];
  const compose = {
    ...startedSandbox({ stop }),
    inspectResources: () => Promise.reject(new Error('resource inventory unavailable')),
  };
  const runtime = new SandboxRuntime({
    driver: { start: () => Promise.resolve(compose) },
    now: deterministicClock(),
    onEvent: () => undefined,
  });
  await expect(
    runtime.start({
      sandbox: { ...input, stopTimeoutMs: 10 },
      progress: { kind: 'events', sink: { emit: (event) => events.push(event) } },
    }),
  ).rejects.toMatchObject({
    failure: {
      startupError: { message: 'resource inventory unavailable' },
      cleanup: { kind: 'failed', error: { message: 'Startup cleanup timed out after 10ms' } },
      record: { kind: 'written' },
    },
  });
  expect(events.map(({ kind }) => kind)).toEqual([
    'acquisition-started',
    'containers-acquired',
    'acquisition-failed',
  ]);
  expect(stop).toHaveBeenCalledOnce();
  expect(await readSandboxRecord(input)).toMatchObject({
    state: 'start-failed',
    cleanup: { kind: 'failed' },
    primaryError: { message: 'resource inventory unavailable' },
  });
});

it('blocks execution as soon as stop starts, including after failed cleanup', async () => {
  const { input } = await sandboxFixture();
  const pending = Promise.withResolvers<undefined>();
  const stopEntered = Promise.withResolvers<undefined>();
  const stop = () => {
    stopEntered.resolve(undefined);
    return pending.promise;
  };
  const execute = vi.fn(() =>
    Promise.resolve({ exitCode: 0, stdout: '', stderr: '', combined: '' }),
  );
  const runtime = new SandboxRuntime({
    driver: {
      start: () => Promise.resolve({ ...startedSandbox({ stop }), execute }),
    },
    now: deterministicClock(),
    onEvent: () => undefined,
  });
  const handle = await runtime.start(silentStart(input));
  const stopping = handle.stop({ reason: 'interrupted' });
  const request = { kind: 'container-exec', service: 'orders', argv: ['true'] } as const;
  await expect(handle.execute(request)).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'sandbox-not-running', state: 'stopping' },
  });
  const rejection = expect(stopping).rejects.toMatchObject({
    failure: { kind: 'cleanup-failed', cleanupError: { message: 'daemon gone' } },
  });
  await stopEntered.promise;
  pending.reject(new Error('daemon gone'));
  await rejection;
  await expect(handle.execute(request)).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'sandbox-not-running', state: 'stop-failed' },
  });
  expect(execute).not.toHaveBeenCalled();
});

it('supports all declared services while keeping presentation failures isolated', async () => {
  const { input } = await sandboxFixture();
  const compose = startedSandbox({ stop: () => Promise.resolve() });
  const handle = await new SandboxRuntime({
    driver: { start: () => Promise.resolve(compose) },
    now: deterministicClock(),
    onEvent: () => {
      throw new Error('subscriber failed');
    },
  }).start(
    silentStart({ ...input, serviceSelection: { kind: 'all', declaredServices: ['orders'] } }),
  );
  expect([...handle.containers.keys()]).toEqual(['orders']);
  await handle.stop({ reason: 'completed' });
  expect(await readSandboxRecord(input)).toMatchObject({ state: 'completed', cleanup: 'complete' });
});
